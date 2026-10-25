import { AppError } from "../errors";
import { randomUUID } from "node:crypto";
import {
  applyCommand,
  emptyState,
  normalizeState,
  stateSchema,
  type AppState,
  type TrustedCommand,
} from "../domain";
import { scenarios } from "../scenarios";
import { database, transaction } from "./database";
import type { Phase, PlanMeta } from "./types";

export function readLocalState(): AppState {
  const row = database()
    .prepare("SELECT state FROM app_state WHERE id=1")
    .get() as { state: string } | undefined;
  if (!row) return emptyState();
  try {
    return normalizeState(stateSchema.parse(JSON.parse(row.state)), scenarios);
  } catch {
    throw new AppError(
      "STATE_INVALID",
      "Локальные данные имеют неподдерживаемый формат. Сохраните резервную копию профиля.",
      500,
    );
  }
}
export function writeLocalState(state: AppState) {
  database()
    .prepare(
      "INSERT INTO app_state(id,state,revision) VALUES(1,?,1) ON CONFLICT(id) DO UPDATE SET state=excluded.state, revision=app_state.revision+1",
    )
    .run(JSON.stringify(stateSchema.parse(state)));
}
export function enqueuePlan(
  taskId: string,
  context?: { userContext?: string; explicitDeadline?: string },
) {
  const db = database();
  const previous = db
    .prepare("SELECT version,meta FROM task_plans WHERE task_id=?")
    .get(taskId) as { version: number; meta: string } | undefined;
  const version = (previous?.version ?? 0) + 1;
  const state = readLocalState();
  const task = state.tasks.find((t) => t.id === taskId);
  const meta: PlanMeta = task
    ? {
        ...(previous ? JSON.parse(previous.meta) : {}),
        ...context,
      }
    : {};
  db.prepare(
    "UPDATE agent_jobs SET status='cancelled' WHERE task_id=? AND status IN ('pending','running')",
  ).run(taskId);
  db.prepare(
    "INSERT INTO task_plans(task_id,version,phase,message,meta,updated_at) VALUES(?,?,'queued','',?,?) ON CONFLICT(task_id) DO UPDATE SET version=excluded.version,phase='queued',message='',meta=excluded.meta,updated_at=excluded.updated_at",
  ).run(taskId, version, JSON.stringify(meta), new Date().toISOString());
  const jobId = randomUUID();
  db.prepare(
    "INSERT INTO agent_jobs(id,task_id,version,created_at) VALUES(?,?,?,?)",
  ).run(jobId, taskId, version, new Date().toISOString());
  if (task) {
    task.agentJobId = jobId;
    writeLocalState(state);
  }
  return version;
}
export function mutateLocalState(command: TrustedCommand): AppState {
  return transaction(() => {
    const current = readLocalState();
    let updated = applyCommand(current, command, scenarios);
    if (!["tick", "reserveAI", "clearHistory"].includes(command.type))
      updated = applyCommand(updated, { type: "tick", demo: false }, scenarios);
    writeLocalState(updated);
    for (const task of updated.tasks) {
      if (!current.tasks.some((t) => t.id === task.id)) enqueuePlan(task.id);
    }
    if (
      "taskId" in command &&
      command.taskId &&
      [
        "select",
        "setDone",
        "complete",
        "toggleStep",
        "deleteTask",
        "tree",
      ].includes(command.type)
    ) {
      if (
        database()
          .prepare("SELECT 1 FROM task_plans WHERE task_id=?")
          .get(command.taskId)
      )
        enqueuePlan(command.taskId);
    }
    if (
      command.type === "profile" &&
      command.timezone !== current.profile.timezone
    ) {
      const rows = database()
        .prepare("SELECT task_id FROM task_plans")
        .all() as { task_id: string }[];
      rows.forEach((row) => enqueuePlan(row.task_id));
    }
    return readLocalState();
  });
}
export function updatePlan(
  taskId: string,
  version: number,
  phase: Phase,
  message = "",
  meta?: PlanMeta,
) {
  const db = database();
  const result = meta
    ? db
        .prepare(
          "UPDATE task_plans SET phase=?,message=?,meta=?,updated_at=? WHERE task_id=? AND version=?",
        )
        .run(
          phase,
          message,
          JSON.stringify(meta),
          new Date().toISOString(),
          taskId,
          version,
        )
    : db
        .prepare(
          "UPDATE task_plans SET phase=?,message=?,updated_at=? WHERE task_id=? AND version=?",
        )
        .run(phase, message, new Date().toISOString(), taskId, version);
  if (result.changes)
    db.prepare(
      "INSERT INTO agent_log(task_id,version,phase,message,at) VALUES(?,?,?,?,?)",
    ).run(taskId, version, phase, message, new Date().toISOString());
}
export class Superseded extends Error {}
let workerOwner: string | undefined;
export function setWorkerOwner(owner: string | undefined) {
  workerOwner = owner;
}
export function assertWorkerLease() {
  if (!workerOwner) return;
  const lease = database()
    .prepare("SELECT owner,expires FROM worker_lease WHERE id=1")
    .get() as { owner: string; expires: number } | undefined;
  if (lease?.owner !== workerOwner || lease.expires < Date.now())
    throw new Superseded("Блокировка обработчика перешла другому процессу");
}
export function assertVersion(taskId: string, version: number) {
  assertWorkerLease();
  const row = database()
    .prepare("SELECT version FROM task_plans WHERE task_id=?")
    .get(taskId) as { version: number } | undefined;
  if (row?.version !== version)
    throw new Superseded("План изменён пользователем");
}
