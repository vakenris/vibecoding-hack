import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, aiConfigured } from "@/lib/supabase/server";
import { readState, mutateState } from "@/lib/store";
import { generateTree, mentorReply, recommendIdeas } from "@/lib/ai/provider";
export const maxDuration = 60;
const inputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("tree"),
    taskId: z.string().uuid(),
    clarification: z.string().trim().min(1).max(3000),
  }),
  z.object({
    action: z.literal("mentor"),
    taskId: z.string().uuid(),
    message: z.string().trim().min(1).max(2000),
  }),
  z.object({ action: z.literal("ideas") }),
]);
export async function POST(request: Request) {
  try {
    // AI is a cookie-authenticated mutation; refuse cross-origin browser requests.
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return NextResponse.json(
        { error: "Недопустимый источник запроса" },
        { status: 403 },
      );
    if (Number(request.headers.get("content-length")) > 16000)
      return NextResponse.json(
        { error: "Слишком большой запрос" },
        { status: 413 },
      );
    const body = await request.text();
    if (body.length > 16000)
      return NextResponse.json(
        { error: "Слишком большой запрос" },
        { status: 413 },
      );
    const input = inputSchema.parse(JSON.parse(body));
    const { user } = await requireUser();
    if (!aiConfigured())
      return NextResponse.json(
        {
          error:
            "AI пока не подключён. Задача сохранена; готовые сценарии доступны в «Идеях».",
        },
        { status: 503 },
      );
    await mutateState(user.id, { type: "reserveAI" });
    const { state } = await readState(user.id);
    if (input.action === "ideas") {
      const ideas = await recommendIdeas(state);
      return NextResponse.json({
        state: await mutateState(user.id, { type: "ideas", ideas }),
      });
    }
    const task = state.tasks.find((t) => t.id === input.taskId);
    if (!task)
      return NextResponse.json({ error: "Задача не найдена" }, { status: 404 });
    if (input.action === "tree") {
      if (task.tree)
        return NextResponse.json(
          { error: "Дерево уже создано" },
          { status: 409 },
        );
      const tree = await generateTree(state, task, input.clarification);
      return NextResponse.json({
        state: await mutateState(user.id, {
          type: "tree",
          taskId: task.id,
          tree,
        }),
      });
    }
    const { text } = await mentorReply(state, task, input.message);
    await mutateState(user.id, {
      type: "message",
      taskId: task.id,
      message: {
        id: crypto.randomUUID(),
        role: "user",
        text: input.message,
        at: new Date().toISOString(),
        mode: "live",
      },
    });
    return NextResponse.json({
      state: await mutateState(user.id, {
        type: "message",
        taskId: task.id,
        message: {
          id: crypto.randomUUID(),
          role: "assistant",
          text,
          at: new Date().toISOString(),
          mode: "live",
        },
      }),
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof z.ZodError
            ? "Проверьте поля запроса"
            : e instanceof Error
              ? e.message
              : "Не удалось выполнить запрос",
      },
      { status: 400 },
    );
  }
}
