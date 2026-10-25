import type { AppState } from "./schemas";
import { AppError } from "../errors";

/** Exclude worker bookkeeping, which does not affect the requested AI context. */
export function taskContextKey(state: AppState, taskId: string) {
  const task = state.tasks.find((item) => item.id === taskId);
  return JSON.stringify(
    {
      task: task ? { ...task, agentJobId: undefined } : null,
      goals: state.profile.goals,
      messages: state.messages[taskId] ?? [],
    },
    (_key, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, value[key]]),
          )
        : value,
  );
}
export function assertTaskContext(
  state: AppState,
  taskId: string,
  expected: string,
) {
  if (taskContextKey(state, taskId) !== expected)
    throw new AppError(
      "STALE_CONTEXT",
      "Задача или диалог изменились. Повторите запрос с актуальными данными.",
      409,
    );
}
