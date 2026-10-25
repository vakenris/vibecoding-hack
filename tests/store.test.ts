import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/supabase/server", () => ({ supabaseAdmin: vi.fn() }));
import { supabaseAdmin } from "../src/lib/supabase/server";
import { mutateState } from "../src/lib/store";
import {
  applyCommand,
  emptyState,
  taskContextKey,
  type AppState,
} from "../src/lib/domain";
import { scenarios } from "../src/lib/scenarios";
let row: { state: AppState; revision: number };
let conflict: (() => void) | undefined;
beforeEach(() => {
  row = { state: emptyState(), revision: 0 };
  conflict = undefined;
  vi.mocked(supabaseAdmin).mockReturnValue({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: structuredClone(row),
            error: null,
          }),
        }),
      }),
      update: (patch: typeof row) => ({
        eq: () => ({
          eq: (_: string, revision: number) => ({
            select: async () => {
              if (conflict) {
                const fn = conflict;
                conflict = undefined;
                fn();
              }
              if (row.revision !== revision) return { data: [], error: null };
              row = structuredClone(patch);
              return { data: [{ revision: row.revision }], error: null };
            },
          }),
        }),
      }),
    }),
  } as unknown as ReturnType<typeof supabaseAdmin>);
});
const create = (id: string) => ({
  type: "create" as const,
  id,
  title: "Задача",
  description: "",
  category: "home" as const,
  date: "",
  time: "",
  reminder: true,
  source: "manual" as const,
});
it("retries concurrent writes against the latest revision without losing either task", async () => {
  await Promise.all([
    mutateState("u", create(crypto.randomUUID())),
    mutateState("u", create(crypto.randomUUID())),
  ]);
  expect(row.state.tasks).toHaveLength(2);
  expect(row.revision).toBe(2);
});
it("rechecks AI context during a CAS retry and never commits half a conversation", async () => {
  const id = crypto.randomUUID();
  row.state = applyCommand(row.state, create(id), scenarios);
  const expectedContext = taskContextKey(row.state, id);
  conflict = () => {
    row.state = applyCommand(
      row.state,
      { type: "setDone", taskId: id, done: true },
      scenarios,
    );
    row.revision++;
  };
  const message = {
    id: "m",
    role: "user" as const,
    text: "Привет",
    at: new Date().toISOString(),
    mode: "live" as const,
  };
  await expect(
    mutateState("u", {
      type: "mentorExchange",
      taskId: id,
      expectedContext,
      messages: [message, { ...message, id: "a", role: "assistant" }],
    }),
  ).rejects.toMatchObject({ code: "STALE_CONTEXT" });
  expect(row.state.messages[id]).toBeUndefined();
  expect(row.state.tasks[0].done).toBe(true);
});
