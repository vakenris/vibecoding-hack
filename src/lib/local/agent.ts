import { Temporal } from "@js-temporal/polyfill";
import { activeSteps, applyCommand, isTaskDone } from "../domain";
import { scenarios } from "../scenarios";
import { generateLocalTree } from "./tree";
import { database, setting, transaction } from "./database";
import {
  assertVersion,
  readLocalState,
  updatePlan,
  writeLocalState,
} from "./state";
import { choosePlan, understandGoal } from "./agent-ai";
import {
  documentPath,
  extractDocument,
  taskDocument,
  type TextPart,
} from "./documents";
import {
  assertConnection,
  calendarSession,
  storedConnection,
  selectedCalendar,
} from "./caldav";
import {
  createReservedEvent,
  reconcileEvents,
  reserveEvent,
  taskLinks,
} from "./events";
import { busyIntervals } from "./ical";
import {
  deadlineInstant,
  NoFreeTime,
  scheduleSteps,
  type Interval,
  type Slot,
} from "./scheduler";
import { defaultSchedule, type PlanMeta, type ScheduleSettings } from "./types";
import { unlink } from "node:fs/promises";

export interface AgentJob {
  id: string;
  task_id: string;
  version: number;
  attempts: number;
}
export async function runAgentJob(job: AgentJob) {
  const { task_id: taskId, version } = job;
  const check = () => assertVersion(taskId, version);
  check();
  let state = readLocalState();
  let task = state.tasks.find((t) => t.id === taskId);
  if (!task) {
    const document = taskDocument(taskId);
    if (document) {
      database().prepare("DELETE FROM documents WHERE id=?").run(document.id);
      await unlink(documentPath(document.id)).catch(() => {});
    }
  }
  const plan = database()
    .prepare("SELECT meta FROM task_plans WHERE task_id=?")
    .get(taskId) as { meta: string };
  const meta = JSON.parse(plan.meta) as PlanMeta;
  const settings = setting<ScheduleSettings>("schedule", defaultSchedule);
  const connection = storedConnection();
  let session: Awaited<ReturnType<typeof calendarSession>> | undefined;
  const connect = async () => {
    if (!connection?.config.enabled || !connection.config.writeUrl)
      return undefined;
    session ??= await calendarSession(
      connection.config,
      connection.password(),
      connection.revision,
    );
    return session;
  };
  const links = connection ? taskLinks(connection.key, taskId) : [];
  if (links.some((l) => !["deleted", "external_deleted"].includes(l.status))) {
    const remote = await connect();
    if (!remote || !connection) {
      updatePlan(
        taskId,
        version,
        "awaiting_calendar",
        "Синхронизация остановлена. События сохраняются в календаре до подключения.",
        meta,
      );
      return;
    }
    await reconcileEvents({
      taskId,
      task,
      version,
      key: connection.key,
      revision: connection.revision,
      session: remote,
    });
  }
  check();
  if (!task || isTaskDone(task)) {
    updatePlan(
      taskId,
      version,
      "ready",
      task
        ? "События выполненных действий удалены"
        : "События удалённой задачи удалены",
      meta,
    );
    return;
  }
  const document = taskDocument(taskId);
  let parts: TextPart[] = [];
  if (document) {
    if (document.extracted) parts = JSON.parse(document.extracted);
    else {
      updatePlan(
        taskId,
        version,
        "extracting",
        "Разбираю только текст документа",
        meta,
      );
      try {
        parts = await extractDocument(document);
      } catch (error) {
        check();
        database()
          .prepare("UPDATE documents SET status='error',error=? WHERE id=?")
          .run(
            error instanceof Error ? error.message : "Не удалось извлечь текст",
            document.id,
          );
        throw error;
      }
      check();
      database()
        .prepare(
          "UPDATE documents SET status='ready',extracted=?,error='' WHERE id=?",
        )
        .run(JSON.stringify(parts), document.id);
    }
  }
  if (!meta.goal) {
    updatePlan(
      taskId,
      version,
      "understanding",
      "Определяю одну цель и проверяю источники требований",
      meta,
    );
    meta.goal =
      task.source === "scenario" && !document
        ? {
            title: task.title,
            description: task.description,
            deadline: meta.explicitDeadline || null,
            deadlineSource: meta.explicitDeadline
              ? { location: "Срок пользователя", quote: meta.explicitDeadline }
              : null,
            requirements: [],
            clarification: null,
          }
        : await understandGoal(
            task,
            meta,
            parts,
            state.profile.timezone,
            check,
          );
    check();
    transaction(() => {
      check();
      state = readLocalState();
      const current = state.tasks.find((t) => t.id === taskId)!;
      current.title = meta.goal!.title;
      current.description = meta.goal!.description;
      writeLocalState(state);
      updatePlan(taskId, version, "understanding", "Цель сохранена", meta);
    });
    task = state.tasks.find((t) => t.id === taskId)!;
  }
  if (meta.goal.clarification) {
    updatePlan(taskId, version, "needs_input", meta.goal.clarification, meta);
    return;
  }
  if (!task.tree) {
    updatePlan(
      taskId,
      version,
      "tree",
      "Строю подробные варианты и конечные чек-листы",
      meta,
    );
    const tree = await generateLocalTree(state, task, meta, check, (message) =>
      updatePlan(taskId, version, "tree", message, meta),
    );
    check();
    transaction(() => {
      check();
      state = applyCommand(
        readLocalState(),
        { type: "tree", taskId, tree },
        scenarios,
      );
      writeLocalState(state);
      database().prepare("DELETE FROM tree_drafts WHERE task_id=?").run(taskId);
    });
    task = state.tasks.find((t) => t.id === taskId)!;
  }
  const steps = activeSteps(task);
  if (
    !steps.length ||
    !meta.estimates ||
    steps.some((s) => !meta.estimates!.some((e) => e.stepId === s.id))
  ) {
    updatePlan(
      taskId,
      version,
      "choosing",
      "Учитываю выбранные пользователем ветки",
      meta,
    );
    const choice = await choosePlan(
      state,
      task,
      meta,
      settings.defaultMinutes,
      check,
    );
    check();
    transaction(() => {
      check();
      state = readLocalState();
      for (const node of choice.path) {
        const child = choice.selected[node.id];
        if (
          child &&
          state.tasks.find((t) => t.id === taskId)!.selected[node.id] !== child
        )
          state = applyCommand(
            state,
            { type: "select", taskId, parent: node.id, child },
            scenarios,
          );
      }
      writeLocalState(state);
      meta.estimates = choice.estimates;
      meta.explanation = choice.explanation;
      updatePlan(
        taskId,
        version,
        "choosing",
        "Путь и оценки длительности сохранены",
        meta,
      );
    });
    task = state.tasks.find((t) => t.id === taskId)!;
  }
  const remote = await connect();
  if (!remote || !connection) {
    updatePlan(
      taskId,
      version,
      "awaiting_calendar",
      "План готов. Подключите CalDAV и выберите календарь для записи в настройках.",
      meta,
    );
    return;
  }
  check();
  assertConnection(connection.revision);
  await reconcileEvents({
    taskId,
    task,
    version,
    key: connection.key,
    revision: connection.revision,
    session: remote,
  });
  updatePlan(
    taskId,
    version,
    "finding",
    "Проверяю занятость и порядок действий",
    meta,
  );
  const now = Date.now();
  const until = Temporal.Instant.fromEpochMilliseconds(now)
    .toZonedDateTimeISO(state.profile.timezone)
    .toPlainDate()
    .add({ days: settings.horizonDays })
    .toZonedDateTime(state.profile.timezone).epochMilliseconds;
  const busy: Interval[] = [];
  for (const url of new Set([
    ...connection.config.busyUrls,
    connection.config.writeUrl,
  ])) {
    check();
    assertConnection(connection.revision);
    const objects = await remote.client.fetchCalendarObjects({
      calendar: selectedCalendar(remote, url),
      timeRange: {
        start: new Date(now).toISOString(),
        end: new Date(until).toISOString(),
      },
    });
    for (const object of objects) {
      if (typeof object.data !== "string")
        throw new Error("Не удалось прочитать занятость календаря");
      busy.push(
        ...busyIntervals(object.data, now, until, state.profile.timezone),
      );
    }
  }
  const reservations = database()
    .prepare(
      "SELECT start,end FROM event_links WHERE connection_key=? AND task_id<>? AND status='pending'",
    )
    .all(connection.key, taskId) as { start: string; end: string }[];
  busy.push(
    ...reservations.map((r) => ({
      start: Date.parse(r.start),
      end: Date.parse(r.end),
    })),
  );
  const currentLinks = taskLinks(connection.key, taskId);
  const incomplete = activeSteps(task).filter(
    (s) => !task!.completed.includes(s.id),
  );
  const effectiveDeadline = meta.explicitDeadline || meta.goal.deadline;
  const deadlineEnd = effectiveDeadline
    ? deadlineInstant(effectiveDeadline, state.profile.timezone)
    : Infinity;
  const slots: Slot[] = [];
  let cursor = now;
  for (let index = 0; index < incomplete.length; index++) {
    const step = incomplete[index];
    const existing = currentLinks.find((l) => l.step_id === step.id);
    if (existing?.status === "external_deleted") continue;
    if (existing?.status === "active") {
      if (Date.parse(existing.end) > deadlineEnd)
        throw new NoFreeTime(
          "Существующее событие заканчивается после срока задачи. События сохранены; измените их время в календаре или уточните срок.",
        );
      if (
        Date.parse(existing.start) < cursor &&
        Date.parse(existing.end) > now &&
        cursor > now
      )
        throw new NoFreeTime(
          "Внешний перенос события нарушил порядок шагов. Проверьте время в календаре или измените путь.",
        );
      cursor = Math.max(
        cursor,
        Date.parse(existing.end) + settings.breakMinutes * 60000,
      );
      continue;
    }
    const nextAnchor = incomplete
      .slice(index + 1)
      .map((s) =>
        currentLinks.find((l) => l.step_id === s.id && l.status === "active"),
      )
      .find(Boolean);
    let deadline = effectiveDeadline;
    if (nextAnchor) {
      const latest =
        Date.parse(nextAnchor.start) - settings.breakMinutes * 60000;
      if (
        !deadline ||
        latest < deadlineInstant(deadline, state.profile.timezone)
      )
        deadline = new Date(latest).toISOString();
    }
    const [slot] = scheduleSteps({
      steps: [meta.estimates!.find((e) => e.stepId === step.id)!],
      busy,
      settings,
      timezone: state.profile.timezone,
      now,
      after: cursor,
      deadline,
    });
    slots.push(slot);
    busy.push({ start: Date.parse(slot.start), end: Date.parse(slot.end) });
    cursor = Date.parse(slot.end) + settings.breakMinutes * 60000;
  }
  check();
  assertConnection(connection.revision);
  const reserved = transaction(() => {
    check();
    return slots.map((slot) => {
      const step = incomplete.find((s) => s.id === slot.stepId)!;
      const estimate = meta.estimates!.find((s) => s.stepId === step.id)!;
      return reserveEvent({
        key: connection.key,
        calendarUrl: connection.config.writeUrl,
        taskId,
        stepId: step.id,
        title: step.title,
        instruction: `${step.hint}${estimate.businessHours ? "\nРабочее окно — ориентир для планирования. Перед обращением проверьте реальные часы работы организации." : ""}`,
        start: slot.start,
        end: slot.end,
        version,
      });
    });
  });
  updatePlan(
    taskId,
    version,
    "creating",
    `Создаю отдельные события: ${reserved.length}`,
    meta,
  );
  for (const link of reserved)
    await createReservedEvent(remote, link, connection.revision, check);
  check();
  updatePlan(
    taskId,
    version,
    "ready",
    currentLinks.some((l) => l.status === "external_deleted")
      ? "План готов. События, удалённые извне, сохранены как удалённые; шаги не отмечены выполненными."
      : "Шаги запланированы. После выполнения события удаляются.",
    meta,
  );
}
