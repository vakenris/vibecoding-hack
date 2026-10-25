import { beforeAll, afterAll, afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
vi.mock("../src/lib/local/caldav", () => ({
  assertConnection: vi.fn(),
  readObject: vi.fn(),
  selectedCalendar: vi.fn(),
}));
import {
  createReservedEvent,
  reserveEvent,
  taskLinks,
} from "../src/lib/local/events";
import {
  readObject,
  assertConnection,
  type CalendarSession,
} from "../src/lib/local/caldav";
import { makeEvent } from "../src/lib/local/ical";
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "lifepilot-events-"));
  vi.stubEnv("LOCAL_DATA_DIR", dir);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
afterEach(() => vi.clearAllMocks());
it.each(["plan", "connection"])(
  "does not acknowledge an event after losing its %s fence during GET",
  async (fence) => {
    const link = reserveEvent({
      key: fence,
      calendarUrl: "https://calendar.invalid/test/",
      taskId: crypto.randomUUID(),
      stepId: "s",
      title: "Шаг",
      instruction: "Действие",
      start: "2026-11-01T10:00:00Z",
      end: "2026-11-01T11:00:00Z",
      version: 1,
    });
    let changed = false;
    const check = () => {
      if (changed && fence === "plan") throw new Error("superseded");
    };
    vi.mocked(assertConnection).mockImplementation(() => {
      if (changed && fence === "connection") throw new Error("superseded");
    });
    vi.mocked(readObject).mockImplementationOnce(async () => {
      changed = true;
      return { url: link.remote_url, etag: '"v1"', data: makeEvent(link) };
    });
    await expect(
      createReservedEvent({} as CalendarSession, link, 1, check),
    ).rejects.toThrow("superseded");
    expect(taskLinks(fence, link.task_id)[0].status).toBe("pending");
  },
);
