import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { database, transaction } from "../src/lib/local/database";
import {
  assertVersion,
  enqueuePlan,
  mutateLocalState,
  readLocalState,
  writeLocalState,
  updatePlan,
} from "../src/lib/local/state";
import { localSnapshot } from "../src/lib/local/snapshot";
import { applyCommand, emptyState } from "../src/lib/domain";
import { scenarios } from "../src/lib/scenarios";
let dir: string;
const create = (id = randomUUID()) => ({
  type: "create" as const,
  id,
  title: "Подготовить документы",
  description: "",
  category: "home" as const,
  date: "",
  time: "",
  reminder: true,
  source: "thought" as const,
});
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "lifepilot-state-"));
  process.env.LOCAL_DATA_DIR = dir;
});
beforeEach(() => {
  database().exec(
    "DELETE FROM app_state; DELETE FROM task_plans; DELETE FROM agent_jobs;",
  );
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
describe("local persistence and job versions", () => {
  it("returns plain objects for the React Server Component boundary", () => {
    const command = create();
    mutateLocalState(command);
    updatePlan(command.id, 1, "finding", "Test log");
    const snapshot = localSnapshot();
    const visit = (value: unknown) => {
      if (value && typeof value === "object") {
        if (!Array.isArray(value))
          expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
        Object.values(value).forEach(visit);
      }
    };
    visit(snapshot);
    expect(snapshot.plans[0].logs).toHaveLength(1);
  });
  it("commits task creation and its durable job in the same transaction", () => {
    const command = create();
    const state = mutateLocalState(command);
    const job = database()
      .prepare("SELECT * FROM agent_jobs WHERE task_id=?")
      .get(command.id) as { id: string; version: number; status: string };
    expect(job.status).toBe("pending");
    expect(job.version).toBe(1);
    expect(state.tasks[0].agentJobId).toBe(job.id);
    expect(readLocalState()).toEqual(state);
  });
  it("rolls the task back when queue insertion fails", () => {
    database().exec(
      "CREATE TRIGGER injected_queue_failure BEFORE INSERT ON agent_jobs BEGIN SELECT RAISE(ABORT, 'injected failure'); END;",
    );
    try {
      expect(() => mutateLocalState(create())).toThrow(/injected failure/);
      expect(readLocalState().tasks).toHaveLength(0);
    } finally {
      database().exec("DROP TRIGGER injected_queue_failure");
    }
  });
  it("cancels the old job and fences model responses when the user completes a task", () => {
    const command = create();
    mutateLocalState(command);
    mutateLocalState({ type: "setDone", taskId: command.id, done: true });
    const jobs = database()
      .prepare("SELECT version,status FROM agent_jobs ORDER BY version")
      .all();
    expect(jobs).toEqual([
      { version: 1, status: "cancelled" },
      { version: 2, status: "pending" },
    ]);
    expect(() => assertVersion(command.id, 1)).toThrow();
    assertVersion(command.id, 2);
    expect(readLocalState().tasks[0].done).toBe(true);
  });
  it("leaves old tasks out of the calendar until explicitly enrolled", () => {
    const command = create();
    writeLocalState(applyCommand(emptyState(), command, scenarios));
    mutateLocalState({ type: "tick", demo: false });
    expect(database().prepare("SELECT id FROM agent_jobs").all()).toEqual([]);
    transaction(() => enqueuePlan(command.id));
    expect(database().prepare("SELECT id FROM agent_jobs").all()).toHaveLength(
      1,
    );
  });
});

it("commits mentor exchanges atomically and rejects a stale conversation", async () => {
  const { taskContextKey } = await import("../src/lib/domain");
  const command = create();
  const current = mutateLocalState(command);
  const expectedContext = taskContextKey(current, command.id);
  const message = {
    id: "user",
    role: "user" as const,
    text: "Вопрос",
    mode: "live" as const,
    at: new Date().toISOString(),
  };
  const exchange = {
    type: "mentorExchange" as const,
    taskId: command.id,
    expectedContext,
    messages: [
      message,
      { ...message, id: "assistant", role: "assistant" as const },
    ] as [
      typeof message,
      { id: string; role: "assistant"; text: string; mode: "live"; at: string },
    ],
  };
  database().exec(
    "CREATE TRIGGER injected_message_failure BEFORE UPDATE ON app_state BEGIN SELECT RAISE(ABORT, 'write failed'); END;",
  );
  try {
    expect(() => mutateLocalState(exchange)).toThrow();
    expect(readLocalState().messages[command.id]).toBeUndefined();
  } finally {
    database().exec("DROP TRIGGER injected_message_failure");
  }
  expect(mutateLocalState(exchange).messages[command.id]).toHaveLength(2);
  expect(() => mutateLocalState(exchange)).toThrow(/изменились/);
});
it("fences an expired or reassigned worker lease", async () => {
  const { setWorkerOwner, assertWorkerLease } =
    await import("../src/lib/local/state");
  setWorkerOwner("test-owner");
  try {
    database()
      .prepare("INSERT OR REPLACE INTO worker_lease VALUES(1,?,?)")
      .run("test-owner", Date.now() - 1);
    expect(() => assertWorkerLease()).toThrow(/Блокировка/);
    database()
      .prepare("UPDATE worker_lease SET owner=?,expires=?")
      .run("other-owner", Date.now() + 60000);
    expect(() => assertWorkerLease()).toThrow(/Блокировка/);
  } finally {
    setWorkerOwner(undefined);
    database().exec("DELETE FROM worker_lease");
  }
});
