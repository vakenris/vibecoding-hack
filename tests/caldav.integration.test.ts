import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import {
  calendarSession,
  readObject,
  saveConnection,
  storedConnection,
} from "../src/lib/local/caldav";
import {
  createReservedEvent,
  reconcileEvents,
  reserveEvent,
  taskLinks,
} from "../src/lib/local/events";
import {
  assertVersion,
  mutateLocalState,
  readLocalState,
} from "../src/lib/local/state";
import { database } from "../src/lib/local/database";
import { activePath, activeSteps, type Task } from "../src/lib/domain";
import { scenarios } from "../src/lib/scenarios";
const base = process.env.LIFEPILOT_TEST_CALDAV;
let dir: string;
let session: Awaited<ReturnType<typeof calendarSession>>;
let key: string, revision: number, calendarUrl: string;
function currentVersion(id: string) {
  return (
    database()
      .prepare("SELECT version FROM task_plans WHERE task_id=?")
      .get(id) as { version: number }
  ).version;
}
function task(id: string) {
  return readLocalState().tasks.find((t) => t.id === id)!;
}
function newTask() {
  const id = randomUUID();
  mutateLocalState({
    type: "scenario",
    id,
    scenarioId: scenarios[0].id,
    date: "",
  });
  let current = task(id);
  while (activePath(current).at(-1)!.children.length) {
    const node = activePath(current).at(-1)!;
    mutateLocalState({
      type: "select",
      taskId: id,
      parent: node.id,
      child: node.children[0],
    });
    current = task(id);
  }
  return current;
}
function reservation(current: Task) {
  const step = activeSteps(current)[0];
  return reserveEvent({
    key,
    taskId: current.id,
    stepId: step.id,
    calendarUrl,
    title: step.title,
    instruction: step.hint,
    start: "2026-11-02T09:00:00Z",
    end: "2026-11-02T09:30:00Z",
    version: currentVersion(current.id),
  });
}
async function reconcile(current: Task) {
  await reconcileEvents({
    taskId: current.id,
    task: current,
    version: currentVersion(current.id),
    key,
    revision,
    session,
  });
}
describe.skipIf(!base)("real Radicale lifecycle (isolated calendar)", () => {
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "lifepilot-sync-"));
    process.env.LOCAL_DATA_DIR = dir;
    session = await calendarSession(
      { url: base!, username: "pilot" },
      "local-test-password",
    );
    calendarUrl = session.calendars[0].url;
    saveConnection(
      {
        url: base!,
        username: "pilot",
        enabled: true,
        calendars: [{ url: calendarUrl, name: "Test" }],
        writeUrl: calendarUrl,
        busyUrls: [calendarUrl],
      },
      "local-test-password",
    );
    key = storedConnection()!.key;
    revision = storedConnection()!.revision;
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  it("discovers calendars and encrypts the password with a private local key", async () => {
    expect(session.calendars.length).toBeGreaterThan(0);
    const row = database()
      .prepare("SELECT secret FROM calendar_connection")
      .get() as { secret: string };
    expect(row.secret).not.toContain("local-test-password");
    expect(storedConnection()!.password()).toBe("local-test-password");
    expect((await stat(join(dir, "calendar.key"))).mode & 0o777).toBe(0o600);
  });
  it("creates one stable UID and repeated operations do not duplicate it", async () => {
    const current = newTask(),
      link = reservation(current);
    await createReservedEvent(session, link, revision, () =>
      assertVersion(current.id, currentVersion(current.id)),
    );
    await createReservedEvent(session, link, revision, () =>
      assertVersion(current.id, currentVersion(current.id)),
    );
    const objects = await session.client.fetchCalendarObjects({
      calendar: session.calendars[0],
    });
    expect(
      objects.filter((o) =>
        o.data.replace(/\r?\n[ \t]/g, "").includes(link.uid),
      ),
    ).toHaveLength(1);
    expect(taskLinks(key, current.id)[0].etag).toBeTruthy();
  });
  it("preserves externally moved times and treats external deletion as a tombstone", async () => {
    const current = newTask(),
      link = reservation(current);
    await createReservedEvent(session, link, revision, () => {});
    const object = (await readObject(session, link.remote_url))!;
    const response = await session.request(link.remote_url, {
      method: "PUT",
      headers: { "Content-Type": "text/calendar", "If-Match": object.etag! },
      body: object.data
        .replace(/20261102T090000Z/g, "20261102T120000Z")
        .replace(/20261102T093000Z/g, "20261102T123000Z"),
    });
    expect(response.ok).toBe(true);
    await reconcile(current);
    expect(taskLinks(key, current.id)[0].start).toBe(
      "2026-11-02T12:00:00.000Z",
    );
    await session.request(link.remote_url, { method: "DELETE" });
    await reconcile(current);
    expect(taskLinks(key, current.id)[0].status).toBe("external_deleted");
    expect(task(current.id).completed).toEqual([]);
    await reconcile(current);
    expect(await readObject(session, link.remote_url)).toBeNull();
  });
  it("deletes events on step completion and accepts a repeated missing deletion", async () => {
    const current = newTask(),
      link = reservation(current);
    await createReservedEvent(session, link, revision, () => {});
    mutateLocalState({
      type: "toggleStep",
      taskId: current.id,
      stepId: link.step_id,
      done: true,
    });
    await reconcile(task(current.id));
    await reconcile(task(current.id));
    expect(await readObject(session, link.remote_url)).toBeNull();
    expect(taskLinks(key, current.id)[0].status).toBe("deleted");
  });
  it("cleans the previous branch and fences a stale in-flight plan", async () => {
    const current = newTask(),
      link = reservation(current);
    await createReservedEvent(session, link, revision, () => {});
    const oldVersion = currentVersion(current.id),
      root = current.tree!.nodes.find((n) => n.id === current.tree!.rootId)!;
    mutateLocalState({
      type: "select",
      taskId: current.id,
      parent: root.id,
      child: root.children[1],
    });
    expect(() => assertVersion(current.id, oldVersion)).toThrow();
    await reconcile(task(current.id));
    expect(await readObject(session, link.remote_url)).toBeNull();
  });
  it("deletes only owned events when the whole task completes", async () => {
    const current = newTask(),
      link = reservation(current);
    await createReservedEvent(session, link, revision, () => {});
    const foreignUrl = `${calendarUrl}foreign-${randomUUID()}.ics`;
    await session.request(foreignUrl, {
      method: "PUT",
      headers: { "Content-Type": "text/calendar", "If-None-Match": "*" },
      body: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Other//EN\r\nBEGIN:VEVENT\r\nUID:foreign\r\nDTSTART:20261103T090000Z\r\nDTEND:20261103T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
    });
    mutateLocalState({ type: "setDone", taskId: current.id, done: true });
    await reconcile(task(current.id));
    expect(await readObject(session, link.remote_url)).toBeNull();
    expect(await readObject(session, foreignUrl)).not.toBeNull();
  });
  it("uses ETag to refuse a stale delete and retries against the new version", async () => {
    const current = newTask(),
      link = reservation(current);
    await createReservedEvent(session, link, revision, () => {});
    mutateLocalState({ type: "setDone", taskId: current.id, done: true });
    const remove = session.client.deleteCalendarObject.bind(session.client);
    const spy = vi
      .spyOn(session.client, "deleteCalendarObject")
      .mockImplementationOnce(async (input) => {
        const object = (await readObject(session, link.remote_url))!;
        await session.request(link.remote_url, {
          method: "PUT",
          headers: {
            "Content-Type": "text/calendar",
            "If-Match": object.etag!,
          },
          body: object.data.replace("SUMMARY:", "SUMMARY:Externally edited "),
        });
        return remove(input);
      });
    try {
      await expect(reconcile(task(current.id))).rejects.toThrow(/412/);
    } finally {
      spy.mockRestore();
    }
    expect(await readObject(session, link.remote_url)).not.toBeNull();
    await reconcile(task(current.id));
    expect(await readObject(session, link.remote_url)).toBeNull();
  });
  it("refuses deletion when ownership markers were altered externally", async () => {
    const current = newTask(),
      link = reservation(current);
    await createReservedEvent(session, link, revision, () => {});
    const object = (await readObject(session, link.remote_url))!;
    await session.request(link.remote_url, {
      method: "PUT",
      headers: { "Content-Type": "text/calendar", "If-Match": object.etag! },
      body: object.data.replace(
        `X-LIFEPILOT-TASK-ID:${current.id}`,
        "X-LIFEPILOT-TASK-ID:other",
      ),
    });
    mutateLocalState({ type: "setDone", taskId: current.id, done: true });
    await expect(reconcile(task(current.id))).rejects.toThrow(/Идентификаторы/);
    expect(await readObject(session, link.remote_url)).not.toBeNull();
  });
  it("stops operations after disconnect while retaining created events", async () => {
    const current = newTask(),
      link = reservation(current);
    await createReservedEvent(session, link, revision, () => {});
    const config = storedConnection()!.config;
    saveConnection({ ...config, enabled: false });
    await expect(
      createReservedEvent(session, link, revision, () => {}),
    ).rejects.toThrow(/Подключение/);
    expect(await readObject(session, link.remote_url)).not.toBeNull();
    saveConnection({ ...config, enabled: true });
    revision = storedConnection()!.revision;
  });
  it("recovers a PUT whose successful response was lost without duplicating events", async () => {
    let drop = true;
    const proxy = createServer((req, res) => {
      const upstream = httpRequest(
        `${base}${req.url}`,
        { method: req.method, headers: req.headers },
        (response) => {
          if (req.method === "PUT" && drop) {
            drop = false;
            response.resume();
            response.on("end", () => res.destroy());
          } else {
            res.writeHead(response.statusCode!, response.headers);
            response.pipe(res);
          }
        },
      );
      upstream.on("error", () => res.destroy());
      req.pipe(upstream);
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const address = proxy.address() as { port: number };
    const proxyUrl = `http://127.0.0.1:${address.port}`;
    process.env.LOCAL_CALDAV_HTTP_URL = proxyUrl;
    try {
      const remote = await calendarSession(
        { url: proxyUrl, username: "pilot" },
        "local-test-password",
      );
      const current = newTask();
      const link = reserveEvent({
        key,
        taskId: current.id,
        stepId: activeSteps(current)[0].id,
        calendarUrl: remote.calendars[0].url,
        title: "Network retry",
        instruction: "Test",
        start: "2026-11-04T09:00:00Z",
        end: "2026-11-04T09:30:00Z",
        version: currentVersion(current.id),
      });
      await expect(
        createReservedEvent(remote, link, revision, () => {}),
      ).rejects.toThrow(/CalDAV/);
      await createReservedEvent(remote, link, revision, () => {});
      const objects = await remote.client.fetchCalendarObjects({
        calendar: remote.calendars[0],
      });
      expect(
        objects.filter((o) =>
          o.data.replace(/\r?\n[ \t]/g, "").includes(link.uid),
        ),
      ).toHaveLength(1);
    } finally {
      process.env.LOCAL_CALDAV_HTTP_URL = base!;
      proxy.closeAllConnections();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  }, 30000);
});
