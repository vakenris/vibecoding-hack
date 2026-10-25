import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
vi.mock("../src/lib/ai/provider", () => ({
  generateTree: vi.fn(),
  modelJSON: vi.fn(),
}));
vi.mock("../src/lib/local/agent-ai", () => ({
  choosePlan: vi.fn(),
  understandGoal: vi.fn(),
}));
import { runAgentJob } from "../src/lib/local/agent";
import { choosePlan } from "../src/lib/local/agent-ai";
import { mutateLocalState, readLocalState } from "../src/lib/local/state";
import { database } from "../src/lib/local/database";
import { scenarios } from "../src/lib/scenarios";
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "lifepilot-agent-"));
  process.env.LOCAL_DATA_DIR = dir;
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
describe("agent/user concurrency", () => {
  it("discards the model result when the user completes the task mid-request", async () => {
    const id = randomUUID();
    mutateLocalState({
      type: "scenario",
      id,
      scenarioId: scenarios[0].id,
      date: "",
    });
    let release: (value: Awaited<ReturnType<typeof choosePlan>>) => void;
    let started: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.mocked(choosePlan).mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const job = database()
      .prepare(
        "SELECT id,task_id,version,attempts FROM agent_jobs WHERE task_id=?",
      )
      .get(id) as unknown as Parameters<typeof runAgentJob>[0];
    const running = runAgentJob(job);
    await entered;
    mutateLocalState({ type: "setDone", taskId: id, done: true });
    release!({
      selected: {},
      explanation: "stale result",
      estimates: [],
      path: [],
    });
    await expect(running).rejects.toThrow(/изменён пользователем/);
    expect(readLocalState().tasks[0].done).toBe(true);
    expect(readLocalState().tasks[0].selected).toEqual({});
    expect(database().prepare("SELECT uid FROM event_links").all()).toEqual([]);
  });
});
