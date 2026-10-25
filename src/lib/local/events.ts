import { createHash } from "node:crypto";
import { activeSteps, isTaskDone, type Task } from "../domain";
import { database } from "./database";
import { assertVersion } from "./state";
import {
  assertConnection,
  CalendarFailure,
  readObject,
  selectedCalendar,
  type CalendarSession,
} from "./caldav";
import { makeEvent, ownedEvent } from "./ical";
import type { LocalEvent } from "./types";

export interface EventLink {
  connection_key: string;
  task_id: string;
  step_id: string;
  uid: string;
  calendar_url: string;
  remote_url: string;
  etag: string | null;
  start: string;
  end: string;
  title: string;
  instruction: string;
  plan_version: number;
  status: LocalEvent["status"];
}
export function taskLinks(key: string, taskId: string) {
  return database()
    .prepare("SELECT * FROM event_links WHERE connection_key=? AND task_id=?")
    .all(key, taskId) as unknown as EventLink[];
}
export async function reconcileEvents(input: {
  taskId: string;
  task: Task | undefined;
  version: number;
  key: string;
  revision: number;
  session: CalendarSession;
}) {
  const { taskId, task, version, key, revision, session } = input;
  const desired = new Set(
    task && !isTaskDone(task)
      ? activeSteps(task)
          .filter((s) => !task.completed.includes(s.id))
          .map((s) => s.id)
      : [],
  );
  for (const link of taskLinks(key, taskId).filter(
    (l) => l.status !== "deleted",
  )) {
    assertVersion(taskId, version);
    assertConnection(revision);
    selectedCalendar(session, link.calendar_url);
    if (
      !link.remote_url.startsWith(
        link.calendar_url.endsWith("/")
          ? link.calendar_url
          : `${link.calendar_url}/`,
      )
    )
      throw new CalendarFailure("Ссылка события выходит за пределы календаря");
    const object = await readObject(session, link.remote_url);
    assertVersion(taskId, version);
    assertConnection(revision);
    if (!object) {
      const status = !desired.has(link.step_id)
        ? "deleted"
        : link.status === "pending"
          ? "pending"
          : "external_deleted";
      database()
        .prepare("UPDATE event_links SET status=?,etag=NULL WHERE uid=?")
        .run(status, link.uid);
      continue;
    }
    let timing;
    try {
      timing = ownedEvent(object.data, link);
    } catch (error) {
      database()
        .prepare("UPDATE event_links SET status='conflict' WHERE uid=?")
        .run(link.uid);
      throw error;
    }
    if (!desired.has(link.step_id)) {
      if (!object.etag)
        throw new CalendarFailure(
          "Сервер не вернул ETag. Безопасное удаление события невозможно.",
        );
      database()
        .prepare("UPDATE event_links SET status='delete',etag=? WHERE uid=?")
        .run(object.etag, link.uid);
      assertVersion(taskId, version);
      assertConnection(revision);
      const response = await session.client.deleteCalendarObject({
        calendarObject: object,
        headers: { "If-Match": object.etag },
      });
      if (!response.ok && response.status !== 404)
        throw new CalendarFailure(
          `Не удалось удалить событие (HTTP ${response.status})`,
          response.status === 412,
        );
      assertVersion(taskId, version);
      assertConnection(revision);
      database()
        .prepare(
          "UPDATE event_links SET status='deleted',etag=NULL WHERE uid=?",
        )
        .run(link.uid);
    } else {
      database()
        .prepare(
          "UPDATE event_links SET status='active',start=?,end=?,etag=? WHERE uid=?",
        )
        .run(timing.start, timing.end, object.etag ?? null, link.uid);
    }
  }
}
export function reserveEvent(input: {
  key: string;
  calendarUrl: string;
  taskId: string;
  stepId: string;
  title: string;
  instruction: string;
  start: string;
  end: string;
  version: number;
}): EventLink {
  const uid = `lifepilot-${createHash("sha256").update(`${input.key}:${input.taskId}:${input.stepId}`).digest("hex")}@local`;
  const remoteUrl = new URL(
    `${encodeURIComponent(uid)}.ics`,
    input.calendarUrl.endsWith("/")
      ? input.calendarUrl
      : `${input.calendarUrl}/`,
  ).href;
  database()
    .prepare(
      "INSERT INTO event_links(connection_key,task_id,step_id,uid,calendar_url,remote_url,start,end,title,instruction,plan_version,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending') ON CONFLICT(connection_key,task_id,step_id) DO UPDATE SET calendar_url=excluded.calendar_url,remote_url=excluded.remote_url,start=excluded.start,end=excluded.end,title=excluded.title,instruction=excluded.instruction,plan_version=excluded.plan_version,status='pending',etag=NULL",
    )
    .run(
      input.key,
      input.taskId,
      input.stepId,
      uid,
      input.calendarUrl,
      remoteUrl,
      input.start,
      input.end,
      input.title,
      input.instruction,
      input.version,
    );
  return taskLinks(input.key, input.taskId).find((l) => l.uid === uid)!;
}
export async function createReservedEvent(
  session: CalendarSession,
  link: EventLink,
  revision: number,
  check: () => void,
) {
  check();
  assertConnection(revision);
  // A previous PUT may have succeeded before its response was lost.
  let object = await readObject(session, link.remote_url);
  if (!object) {
    check();
    assertConnection(revision);
    const response = await session.client.createCalendarObject({
      calendar: selectedCalendar(session, link.calendar_url),
      filename: `${encodeURIComponent(link.uid)}.ics`,
      iCalString: makeEvent(link),
      headers: { "If-None-Match": "*" },
    });
    if (!response.ok && response.status !== 412)
      throw new CalendarFailure(
        `Не удалось создать событие (HTTP ${response.status})`,
        true,
      );
    object = await readObject(session, link.remote_url);
    if (!object)
      throw new CalendarFailure("CalDAV ещё не вернул созданное событие", true);
  }
  check();
  assertConnection(revision);
  const timing = ownedEvent(object.data, link);
  database()
    .prepare(
      "UPDATE event_links SET status='active',start=?,end=?,etag=? WHERE uid=?",
    )
    .run(timing.start, timing.end, object.etag ?? null, link.uid);
}
