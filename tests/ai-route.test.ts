import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/supabase/server", () => ({
  requireUser: vi.fn(async () => ({ user: { id: "user" } })),
}));
vi.mock("../src/lib/store", () => ({
  readState: vi.fn(),
  mutateState: vi.fn(),
}));
vi.mock("../src/lib/ai/provider", () => ({
  mentorReply: vi.fn(),
  generateTree: vi.fn(),
  recommendIdeas: vi.fn(),
}));
import { POST } from "../src/app/api/ai/route";
import { readState, mutateState } from "../src/lib/store";
import { mentorReply } from "../src/lib/ai/provider";
import { emptyState, applyCommand, type AppState } from "../src/lib/domain";
import { scenarios } from "../src/lib/scenarios";
const taskId = "10000000-0000-4000-8000-000000000001";
let state: AppState;
const request = (body: unknown) =>
  new Request("http://localhost/api/ai", {
    method: "POST",
    headers: { Origin: "http://localhost", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.stubEnv("LIFEPILOT_MODE", "cloud");
  vi.stubEnv("AI_BASE_URL", "https://provider.invalid/v1");
  vi.stubEnv("AI_MODEL", "test");
  vi.stubEnv("AI_API_KEY", "test-secret");
  state = applyCommand(
    emptyState(),
    { type: "scenario", id: taskId, scenarioId: scenarios[0].id, date: "" },
    scenarios,
  );
  vi.mocked(readState).mockImplementation(async () => ({
    state: structuredClone(state),
    revision: 0,
  }));
  vi.mocked(mutateState).mockImplementation(async (_, command) => {
    state = applyCommand(state, command, scenarios);
    return structuredClone(state);
  });
  vi.mocked(mentorReply).mockResolvedValue({ text: "Ответ" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("validates task existence before consuming quota", async () => {
  const response = await POST(
    request({
      action: "mentor",
      taskId: crypto.randomUUID(),
      message: "Вопрос",
    }),
  );
  expect(response.status).toBe(404);
  expect(state.aiRequests).toHaveLength(0);
});
it("rejects an existing tree before consuming quota", async () => {
  const response = await POST(
    request({ action: "tree", taskId, clarification: "Уточнение" }),
  );
  expect(response.status).toBe(409);
  expect(state.aiRequests).toHaveLength(0);
});
it("commits mentor messages in one state transaction", async () => {
  const response = await POST(
    request({ action: "mentor", taskId, message: "Вопрос" }),
  );
  expect(response.status).toBe(200);
  expect(state.messages[taskId].map((m) => m.role)).toEqual([
    "user",
    "assistant",
  ]);
  expect(vi.mocked(mutateState).mock.calls).toHaveLength(2); // quota + complete pair
});
it("discards a reply if task context changed while the provider was running", async () => {
  vi.mocked(mentorReply).mockImplementationOnce(async () => {
    state = applyCommand(
      state,
      { type: "setDone", taskId, done: true },
      scenarios,
    );
    return { text: "Устаревший ответ" };
  });
  const response = await POST(
    request({ action: "mentor", taskId, message: "Вопрос" }),
  );
  expect(response.status).toBe(409);
  expect(state.messages[taskId]).toBeUndefined();
});
it("hides unexpected storage exceptions and returns a correlation id", async () => {
  vi.mocked(readState).mockRejectedValueOnce(
    new Error("secret connection string"),
  );
  const response = await POST(request({ action: "ideas" }));
  expect(response.status).toBe(500);
  const body = await response.json();
  expect(body).toMatchObject({
    code: "INTERNAL_ERROR",
    requestId: expect.any(String),
    error: expect.any(String),
  });
  expect(JSON.stringify(body)).not.toContain("secret");
});
it("counts UTF-8 bytes without Content-Length", async () => {
  const response = await POST(
    request({ action: "mentor", taskId, message: "я".repeat(9000) }),
  );
  expect(response.status).toBe(413);
});

it("returns 429 with a stable code when quota is exhausted", async () => {
  state.aiRequests = Array.from({ length: 6 }, () => Date.now());
  const response = await POST(
    request({ action: "mentor", taskId, message: "Вопрос" }),
  );
  expect(response.status).toBe(429);
  expect(await response.json()).toMatchObject({
    code: "RATE_LIMITED",
    retryable: true,
  });
  expect(mentorReply).not.toHaveBeenCalled();
});
it("returns 401 for an unauthenticated cloud request", async () => {
  const { requireUser } = await import("../src/lib/supabase/server");
  const { AppError } = await import("../src/lib/errors");
  vi.mocked(requireUser).mockRejectedValueOnce(
    new AppError("UNAUTHORIZED", "Войдите в аккаунт", 401),
  );
  expect((await POST(request({ action: "ideas" }))).status).toBe(401);
  expect(mutateState).not.toHaveBeenCalled();
});

it("discards a reply when the task was deleted during generation", async () => {
  vi.mocked(mentorReply).mockImplementationOnce(async () => {
    state = applyCommand(state, { type: "deleteTask", taskId }, scenarios);
    return { text: "Устаревший ответ" };
  });
  const response = await POST(
    request({ action: "mentor", taskId, message: "Вопрос" }),
  );
  expect(response.status).toBe(409);
  expect(state.messages[taskId]).toBeUndefined();
});
