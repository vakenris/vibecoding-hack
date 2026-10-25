import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/ai/provider", () => ({ modelJSON: vi.fn() }));
vi.mock("../src/lib/local/caldav", async (original) => ({
  ...(await original<typeof import("../src/lib/local/caldav")>()),
  calendarSession: vi.fn(),
}));
import { modelJSON } from "../src/lib/ai/provider";
import { activePath, activeSteps, type Task } from "../src/lib/domain";
import { executeLocal } from "../src/lib/server/local-profile";
import { runAgentJob, type AgentJob } from "../src/lib/local/agent";
import {
  calendarSession,
  saveConnection,
  storedConnection,
  type CalendarSession,
} from "../src/lib/local/caldav";
import { database } from "../src/lib/local/database";
import { reserveEvent, taskLinks } from "../src/lib/local/events";
import { makeEvent } from "../src/lib/local/ical";
import { NoFreeTime } from "../src/lib/local/scheduler";
import {
  mutateLocalState,
  readLocalState,
  updatePlan,
  writeLocalState,
} from "../src/lib/local/state";
import type { PlanMeta } from "../src/lib/local/types";
let dir: string;
const calendarUrl = "https://calendar.invalid/test/";
const objects = new Map<string, string>();
const create = vi.fn(
  async ({
    filename,
    iCalString,
  }: {
    filename: string;
    iCalString: string;
  }) => {
    objects.set(new URL(filename, calendarUrl).href, iCalString);
    return new Response(null, { status: 201 });
  },
);
const remove = vi.fn();
const session = {
  calendars: [{ url: calendarUrl }],
  request: vi.fn(async (url: string) =>
    objects.has(url)
      ? new Response(objects.get(url), { headers: { ETag: '"v1"' } })
      : new Response(null, { status: 404 }),
  ),
  client: {
    fetchCalendarObjects: vi.fn(async () =>
      [...objects].map(([url, data]) => ({ url, data })),
    ),
    createCalendarObject: create,
    deleteCalendarObject: remove,
  },
} as unknown as CalendarSession;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "lifepilot-scheduling-"));
  vi.stubEnv("LOCAL_DATA_DIR", dir);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  database().exec(
    "DELETE FROM app_state; DELETE FROM task_plans; DELETE FROM agent_jobs; DELETE FROM event_links; DELETE FROM calendar_connection; DELETE FROM agent_log;",
  );
  objects.clear();
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-26T08:00:00Z"));
  saveConnection(
    {
      url: "https://calendar.invalid/",
      username: "fixture",
      enabled: true,
      calendars: [{ url: calendarUrl, name: "Test" }],
      writeUrl: calendarUrl,
      busyUrls: [calendarUrl],
    },
    "test-password",
  );
  vi.mocked(calendarSession).mockResolvedValue(session);
  vi.mocked(modelJSON).mockImplementation(
    async (_instruction, input, schema) => {
      const context = input as {
        steps: { id: string }[];
        userContext?: string;
      };
      return schema.parse({
        estimates: context.steps.map((step) => ({
          stepId: step.id,
          minutes: 30,
          preference: context.userContext?.includes("вечером")
            ? "evening"
            : "any",
          businessHours: false,
        })),
      });
    },
  );
});
afterEach(() => vi.restoreAllMocks());
function preparedTask() {
  const id = crypto.randomUUID();
  mutateLocalState({ type: "scenario", id, scenarioId: "exam", date: "" });
  let task = readLocalState().tasks[0];
  while (activePath(task).at(-1)!.children.length) {
    const node = activePath(task).at(-1)!;
    mutateLocalState({
      type: "select",
      taskId: id,
      parent: node.id,
      child: node.children[0],
    });
    task = readLocalState().tasks[0];
  }
  const state = readLocalState();
  state.profile.timezone = "UTC";
  writeLocalState(state);
  const job = currentJob(id);
  const meta: PlanMeta = {
    userContext: "Раньше ограничений не было",
    goal: {
      title: task.title,
      description: task.description,
      deadline: null,
      deadlineSource: null,
      requirements: [],
      clarification: null,
    },
    explanation: "Старые оценки",
    estimates: activeSteps(task).map((step) => ({
      stepId: step.id,
      minutes: 30,
      preference: "any",
      businessHours: false,
    })),
  };
  updatePlan(id, job.version, "ready", "", meta);
  return { task, meta, job };
}
function currentJob(id: string) {
  return database()
    .prepare(
      "SELECT id,task_id,version,attempts FROM agent_jobs WHERE task_id=? ORDER BY version DESC LIMIT 1",
    )
    .get(id) as unknown as AgentJob;
}
function retainOnlyFirstStep(task: Task, start: string, end: string) {
  const state = readLocalState();
  state.tasks[0].completed = activeSteps(task)
    .slice(1)
    .map((step) => step.id);
  writeLocalState(state);
  const first = activeSteps(task)[0];
  const link = reserveEvent({
    key: storedConnection()!.key,
    calendarUrl,
    taskId: task.id,
    stepId: first.id,
    title: first.title,
    instruction: first.hint,
    start,
    end,
    version: currentJob(task.id).version,
  });
  objects.set(link.remote_url, makeEvent(link));
  database()
    .prepare("UPDATE event_links SET status='active',etag=? WHERE uid=?")
    .run('"v1"', link.uid);
}
it("refuses retained events beyond a newly confirmed earlier deadline", async () => {
  const { task } = preparedTask();
  retainOnlyFirstStep(task, "2026-10-29T09:00:00Z", "2026-10-29T09:30:00Z");
  await executeLocal({
    action: "schedule",
    taskId: task.id,
    deadline: "2026-10-27",
  });
  await expect(runAgentJob(currentJob(task.id))).rejects.toBeInstanceOf(
    NoFreeTime,
  );
  expect(create).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(taskLinks(storedConnection()!.key, task.id)[0].status).toBe("active");
});
it.each([
  { end: "2026-10-28T00:00:00Z", valid: true },
  { end: "2026-10-28T00:01:00Z", valid: false },
])(
  "validates the retained event's end against the inferred deadline ($end)",
  async ({ end, valid }) => {
    const { task, meta, job } = preparedTask();
    meta.goal!.deadline = "2026-10-27";
    updatePlan(task.id, job.version, "queued", "", meta);
    retainOnlyFirstStep(task, "2026-10-27T23:30:00Z", end);
    if (valid) {
      await runAgentJob(job);
      expect(
        database()
          .prepare("SELECT phase FROM task_plans WHERE task_id=?")
          .get(task.id)?.phase,
      ).toBe("ready");
    } else await expect(runAgentJob(job)).rejects.toBeInstanceOf(NoFreeTime);
  },
);
it("re-estimates the chosen path and schedules evenings after a clarification", async () => {
  const { task } = preparedTask();
  await executeLocal({
    action: "schedule",
    taskId: task.id,
    userContext: "Теперь могу заниматься только вечером",
  });
  await runAgentJob(currentJob(task.id));
  expect(modelJSON).toHaveBeenCalled();
  expect(readLocalState().tasks[0].selected).toEqual(task.selected);
  expect(readLocalState().tasks[0].tree).toEqual(task.tree);
  const links = taskLinks(storedConnection()!.key, task.id);
  expect(links).toHaveLength(activeSteps(task).length);
  expect(links.every((link) => new Date(link.start).getUTCHours() >= 17)).toBe(
    true,
  );
});
it("reuses cached estimates on a plain retry without new context", async () => {
  const { task } = preparedTask();
  await executeLocal({ action: "schedule", taskId: task.id });
  await runAgentJob(currentJob(task.id));
  expect(modelJSON).not.toHaveBeenCalled();
  expect(taskLinks(storedConnection()!.key, task.id)[0].start).toBe(
    "2026-10-26T09:00:00.000Z",
  );
});
