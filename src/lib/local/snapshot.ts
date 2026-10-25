import { database, setting } from "./database";
import { publicConnection } from "./caldav";
import {
  defaultSchedule,
  type LocalSnapshot,
  type Phase,
  type PlanMeta,
} from "./types";

export function localSnapshot(): LocalSnapshot {
  const db = database();
  const plans = db
    .prepare("SELECT task_id,version,phase,message,meta FROM task_plans")
    .all() as {
    task_id: string;
    version: number;
    phase: Phase;
    message: string;
    meta: string;
  }[];
  return {
    plans: plans.map((p) => ({
      taskId: p.task_id,
      version: p.version,
      phase: p.phase,
      message: p.message,
      meta: JSON.parse(p.meta) as PlanMeta,
      logs: db
        .prepare(
          "SELECT phase,message,at FROM agent_log WHERE task_id=? ORDER BY id DESC LIMIT 20",
        )
        .all(p.task_id)
        .reverse()
        .map((row) => ({ ...row })) as {
        phase: string;
        message: string;
        at: string;
      }[],
    })),
    events: db
      .prepare(
        "SELECT task_id AS taskId,step_id AS stepId,title,start,end,status FROM event_links WHERE status NOT IN ('deleted','delete')",
      )
      .all()
      .map((row) => ({ ...row })) as unknown as LocalSnapshot["events"],
    documents: db
      .prepare("SELECT id,task_id AS taskId,name,status,error FROM documents")
      .all()
      .map((row) => ({ ...row })) as unknown as LocalSnapshot["documents"],
    connection: publicConnection(),
    settings: setting("schedule", defaultSchedule),
    importedDemo: setting("importedDemo", false),
  };
}
