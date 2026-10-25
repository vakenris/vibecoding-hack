import "server-only";
import { z } from "zod";
import {
  database,
  setSetting,
  setting,
  transaction,
} from "@/lib/local/database";
import {
  readLocalState,
  enqueuePlan,
  writeLocalState,
} from "@/lib/local/state";
import {
  calendarSession,
  saveConnection,
  storedConnection,
} from "@/lib/local/caldav";
import { localSnapshot } from "@/lib/local/snapshot";
import { AppError } from "@/lib/errors";
import { scheduleSettingsSchema, type PlanMeta } from "@/lib/local/types";
import { normalizeState, stateSchema } from "@/lib/domain";
import { scenarios } from "@/lib/scenarios";
import { Temporal } from "@js-temporal/polyfill";

export const localInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("schedule"),
    taskId: z.string().uuid(),
    userContext: z.string().max(2000).optional(),
    deadline: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .or(z.literal(""))
      .optional(),
    restoreDeleted: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("connect"),
    url: z.string().url().max(2000),
    username: z.string().min(1).max(500),
    password: z.string().min(1).max(1000),
  }),
  z.object({
    action: z.literal("calendars"),
    writeUrl: z.string().url(),
    busyUrls: z.array(z.string().url()).min(1).max(100),
  }),
  z.object({ action: z.literal("disconnect") }),
  z.object({ action: z.literal("settings"), settings: scheduleSettingsSchema }),
  z.object({ action: z.literal("import"), state: stateSchema }),
]);
function enqueuePendingPlans() {
  const rows = database()
    .prepare(
      "SELECT task_id FROM task_plans WHERE phase IN ('awaiting_calendar','error','queued','extracting','understanding','tree','choosing','finding','creating')",
    )
    .all() as { task_id: string }[];
  rows.forEach((row) => enqueuePlan(row.task_id));
}
export async function executeLocal(input: z.infer<typeof localInputSchema>) {
  if (input.action === "connect") {
    const session = await calendarSession(input, input.password);
    const calendars = session.calendars.map((c) => ({
      url: c.url,
      name: typeof c.displayName === "string" ? c.displayName : c.url,
    }));
    if (!calendars.length)
      throw new AppError(
        "INVALID_REQUEST",
        "На сервере не найдены календари VEVENT",
      );
    const previous = storedConnection();
    const same =
      previous?.config.url === input.url &&
      previous.config.username === input.username;
    const writeUrl =
      same && calendars.some((c) => c.url === previous.config.writeUrl)
        ? previous.config.writeUrl
        : calendars[0].url;
    transaction(() => {
      saveConnection(
        {
          url: input.url,
          username: input.username,
          calendars,
          enabled: true,
          writeUrl,
          busyUrls: calendars.map((c) => c.url),
        },
        input.password,
      );
      enqueuePendingPlans();
    });
  } else if (input.action === "calendars") {
    const connection = storedConnection();
    if (!connection)
      throw new AppError("INVALID_REQUEST", "Сначала проверьте подключение");
    const allowed = new Set(connection.config.calendars.map((c) => c.url));
    if (![input.writeUrl, ...input.busyUrls].every((url) => allowed.has(url)))
      throw new AppError("INVALID_REQUEST", "Выберите доступные календари");
    transaction(() => {
      saveConnection({
        ...connection.config,
        writeUrl: input.writeUrl,
        busyUrls: [...new Set(input.busyUrls)],
        enabled: true,
      });
      enqueuePendingPlans();
    });
  } else if (input.action === "disconnect") {
    transaction(() => {
      const connection = storedConnection();
      if (connection) saveConnection({ ...connection.config, enabled: false });
      database()
        .prepare(
          "UPDATE agent_jobs SET status='cancelled' WHERE status IN ('running','pending')",
        )
        .run();
      database()
        .prepare(
          "UPDATE task_plans SET version=version+1,phase='awaiting_calendar',message='Синхронизация отключена. Созданные события сохранены.'",
        )
        .run();
    });
  } else if (input.action === "schedule") {
    if (input.deadline) {
      try {
        Temporal.PlainDate.from(input.deadline);
      } catch {
        throw new AppError("INVALID_REQUEST", "Некорректная дата", 400);
      }
    }
    if (!readLocalState().tasks.some((t) => t.id === input.taskId))
      throw new AppError("NOT_FOUND", "Задача не найдена", 404);
    transaction(() => {
      enqueuePlan(input.taskId, {
        ...(input.userContext !== undefined
          ? { userContext: input.userContext }
          : {}),
        ...(input.deadline !== undefined
          ? { explicitDeadline: input.deadline }
          : {}),
      });
      if (input.userContext !== undefined || input.deadline !== undefined) {
        const row = database()
          .prepare("SELECT meta FROM task_plans WHERE task_id=?")
          .get(input.taskId) as { meta: string };
        const meta = JSON.parse(row.meta) as PlanMeta;
        delete meta.goal;
        database()
          .prepare("UPDATE task_plans SET meta=? WHERE task_id=?")
          .run(JSON.stringify(meta), input.taskId);
      }
      if (input.restoreDeleted)
        database()
          .prepare(
            "UPDATE event_links SET status='deleted' WHERE task_id=? AND status='external_deleted'",
          )
          .run(input.taskId);
    });
  } else if (input.action === "settings") {
    transaction(() => {
      setSetting("schedule", input.settings);
      enqueuePendingPlans();
    });
  } else if (input.action === "import") {
    transaction(() => {
      if (readLocalState().tasks.length || setting("importedDemo", false))
        throw new AppError(
          "INVALID_REQUEST",
          "Перенос доступен однократно в пустой профиль",
        );
      const imported = normalizeState(input.state, scenarios);
      imported.tasks.forEach((task) => {
        delete task.documentId;
        delete task.agentJobId;
      });
      writeLocalState(imported);
      setSetting("importedDemo", true);
      // Imported tasks are old tasks: scheduling requires a separate user action.
    });
  }
  return { state: readLocalState(), local: localSnapshot() };
}
