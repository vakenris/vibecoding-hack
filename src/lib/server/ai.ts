import "server-only";
import { z } from "zod";
import {
  type AppState,
  type TrustedCommand,
  taskContextKey,
  isTaskDone,
} from "../domain";
import { aiSettings, localMode } from "../config";
import { AppError } from "../errors";
import { readState, mutateState } from "../store";
import { generateTree, mentorReply, recommendIdeas } from "../ai/provider";

export const aiInputSchema = z.discriminatedUnion("action", [
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
export async function executeAI(
  userId: string,
  input: z.infer<typeof aiInputSchema>,
) {
  const local = localMode() ? await import("../local-store") : null;
  const read = async (): Promise<AppState> =>
    local ? local.readLocalState() : (await readState(userId)).state;
  const save = async (command: TrustedCommand) =>
    local ? local.mutateLocalState(command) : mutateState(userId, command);
  const state = await read();
  const task =
    input.action === "ideas"
      ? undefined
      : state.tasks.find((t) => t.id === input.taskId);
  if (input.action !== "ideas" && !task)
    throw new AppError("NOT_FOUND", "Задача не найдена", 404);
  if (input.action === "tree" && (task!.tree || isTaskDone(task!)))
    throw new AppError(
      "CONFLICT",
      "Дерево уже создано или задача выполнена",
      409,
    );
  aiSettings();
  const expectedContext = task ? taskContextKey(state, task.id) : undefined;
  // The same precondition runs inside SQLite/CAS, including each CAS retry.
  await save(
    task
      ? {
          type: "reserveAI",
          taskId: task.id,
          operation: input.action as "tree" | "mentor",
          expectedContext,
        }
      : { type: "reserveAI" },
  );
  if (input.action === "ideas")
    return save({ type: "ideas", ideas: await recommendIdeas(state) });
  if (input.action === "tree")
    return save({
      type: "tree",
      taskId: task!.id,
      tree: await generateTree(state, task!, input.clarification),
      expectedContext,
    });
  const { text } = await mentorReply(state, task!, input.message);
  const at = new Date().toISOString();
  return save({
    type: "mentorExchange",
    taskId: task!.id,
    expectedContext: expectedContext!,
    messages: [
      {
        id: crypto.randomUUID(),
        role: "user",
        text: input.message,
        at,
        mode: "live",
      },
      { id: crypto.randomUUID(), role: "assistant", text, at, mode: "live" },
    ],
  });
}
