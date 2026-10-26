import "server-only";
import { z } from "zod";
import {
  type AppState,
  type Task,
  generatedTreeSchema,
  categoryIds,
} from "@/lib/domain";
import { aiSettings } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { limitedBody } from "@/lib/http";

const replySchema = z.object({ text: z.string().trim().min(1).max(5000) });
const ideasSchema = z.object({
  ideas: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        description: z.string().max(1000),
        reason: z.string().max(500),
        category: z.enum(categoryIds),
      }),
    )
    .min(1)
    .max(5),
});
import { systemPrompt, treeGuide, mentorGuide, ideasGuide } from "./prompts";
export class ModelResponseError extends AppError {
  constructor(
    message: string,
    temporary = false,
    code = "AI_RESPONSE",
    status = 502,
  ) {
    super(code, message, status, temporary);
  }
  get temporary() {
    return this.retryable;
  }
}

export async function modelJSON<T>(
  instruction: string,
  context: unknown,
  schema: z.ZodType<T>,
  maxTokens = 1800,
): Promise<T> {
  const { endpoint, timeout, useTool } = aiSettings();
  const jsonSchema = z.toJSONSchema(schema, { unrepresentable: "any" });
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.AI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL,
        messages: [
          {
            role: "system",
            content: systemPrompt(instruction, jsonSchema, useTool),
          },
          { role: "user", content: `USER_CONTEXT\n${JSON.stringify(context)}` },
        ],
        max_tokens: maxTokens,
        ...(useTool
          ? {
              tools: [
                {
                  type: "function",
                  function: {
                    name: "lifepilot_result",
                    description:
                      "Вернуть проверяемый структурированный результат LifePilot",
                    parameters: jsonSchema,
                  },
                },
              ],
              tool_choice: {
                type: "function",
                function: { name: "lifepilot_result" },
              },
            }
          : {}),
      }),
      signal: AbortSignal.timeout(timeout),
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ModelResponseError(
        `Провайдер AI вернул HTTP ${response.status}. Проверьте настройки модели.`,
        response.status === 429 || response.status >= 500,
        response.status === 429 ? "AI_RATE_LIMITED" : "AI_HTTP_ERROR",
        response.status === 429 ? 429 : response.status === 504 ? 504 : 502,
      );
    }
    const body = new TextDecoder().decode(
      await limitedBody(
        response,
        200000,
        new ModelResponseError("Ответ AI превышает допустимый размер"),
      ),
    );
    const completion = JSON.parse(body);
    if (!completion || typeof completion !== "object")
      throw new ModelResponseError("AI вернул некорректный JSON", true);
    if (completion.error) {
      const code = Number(completion.error.code);
      throw new ModelResponseError(
        `Провайдер AI вернул ошибку${Number.isFinite(code) ? ` (код ${code})` : ""}. Повторите запрос.`,
        code === 429 || code >= 500,
        code === 429 ? "AI_RATE_LIMITED" : "AI_RESPONSE",
        code === 429 ? 429 : code === 504 ? 504 : 502,
      );
    }
    const calls = completion.choices?.[0]?.message?.tool_calls;
    if (
      calls &&
      (calls.length !== 1 || calls[0]?.function?.name !== "lifepilot_result")
    )
      throw new ModelResponseError(
        "Модель вернула неожиданный формат структурированного вызова.",
        true,
      );
    const content =
      calls?.[0]?.function?.arguments ??
      completion.choices?.[0]?.message?.content;
    if (completion.choices?.[0]?.finish_reason === "length")
      throw new ModelResponseError(
        "Модель исчерпала лимит токенов до готового JSON. Увеличьте AI_MAX_OUTPUT_TOKENS.",
        true,
      );
    if (typeof content !== "string")
      throw new ModelResponseError(
        "Провайдер AI не вернул текст в choices[0].message.content",
      );
    const normalized = content
      .trim()
      .replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1");
    const parsed = schema.safeParse(JSON.parse(normalized));
    if (!parsed.success)
      throw new ModelResponseError(
        `Ответ AI не соответствует схеме. Проверьте поля: ${parsed.error.issues
          .slice(0, 4)
          .map((issue) => issue.path.join(".") || "ответ")
          .join(", ")}.`,
        true,
      );
    return parsed.data;
  } catch (e) {
    if (e instanceof ModelResponseError) throw e;
    if (e instanceof SyntaxError)
      throw new ModelResponseError(
        "AI вернул некорректный JSON. Повторите запрос.",
        true,
      );
    if (
      e instanceof Error &&
      (e.name === "TimeoutError" || e.name === "AbortError")
    )
      throw new ModelResponseError(
        "Модель не успела ответить. Задача сохранена — повторите запрос.",
        true,
        "AI_TIMEOUT",
        504,
      );
    if (e instanceof TypeError) {
      const code = (e.cause as { code?: string } | undefined)?.code;
      throw new ModelResponseError(
        `Не удалось подключиться к AI API${code && /^[A-Z0-9_]{1,60}$/.test(code) ? ` (${code})` : ""}. Проверьте доступность сервера модели.`,
        true,
      );
    }
    throw new ModelResponseError(
      "Не удалось получить корректный ответ AI. Данные сохранены, попробуйте ещё раз.",
      true,
    );
  }
}
export function taskContext(state: AppState, task: Task) {
  return {
    profile: { goals: state.profile.goals },
    task,
    conversation: (state.messages[task.id] ?? []).slice(-16),
  };
}
export async function generateTree(
  state: AppState,
  task: Task,
  clarification: string,
) {
  return modelJSON(
    treeGuide,
    { ...taskContext(state, task), clarification },
    generatedTreeSchema,
    aiSettings().maxTokens,
  );
}
export async function mentorReply(
  state: AppState,
  task: Task,
  message: string,
) {
  return modelJSON(
    mentorGuide,
    { ...taskContext(state, task), message },
    replySchema,
  );
}
export async function recommendIdeas(state: AppState) {
  const result = await modelJSON(
    ideasGuide,
    {
      profile: {
        goals: state.profile.goals,
        interests: state.profile.interests,
      },
      existing: state.tasks.map((t) => t.title),
      dismissed: state.dismissedIdeas,
    },
    ideasSchema,
  );
  return result.ideas.map((idea) => ({ ...idea, id: crypto.randomUUID() }));
}
