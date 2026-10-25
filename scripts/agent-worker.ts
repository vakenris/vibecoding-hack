import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { database, transaction } from "../src/lib/local/database";
import { runAgentJob, type AgentJob } from "../src/lib/local/agent";
import { setWorkerOwner, Superseded, updatePlan } from "../src/lib/local/state";
import { publicError } from "../src/lib/errors";
import { logOperation } from "../src/lib/http";
import { NoFreeTime } from "../src/lib/local/scheduler";

nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
if (process.env.LIFEPILOT_MODE !== "local")
  throw new Error("Обработчик доступен только в LIFEPILOT_MODE=local");
const owner = `${process.pid}:${randomUUID()}`;
const db = database();
setWorkerOwner(owner);
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
function lease() {
  return transaction(() => {
    const previous = db
      .prepare("SELECT owner,expires FROM worker_lease WHERE id=1")
      .get() as { owner: string; expires: number } | undefined;
    if (previous && previous.owner !== owner) {
      const pid = Number(previous.owner.split(":")[0]);
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH")
            db.prepare("UPDATE worker_lease SET expires=0 WHERE owner=?").run(
              previous.owner,
            );
        }
      }
    }
    const acquired = Boolean(
      db
        .prepare(
          "INSERT INTO worker_lease(id,owner,expires) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE worker_lease.expires<? OR worker_lease.owner=?",
        )
        .run(owner, Date.now() + 45000, Date.now(), owner).changes,
    );
    if (acquired && previous?.owner !== owner)
      db.prepare(
        "UPDATE agent_jobs SET locked_until=0 WHERE status='running'",
      ).run();
    return acquired;
  });
}
function claim(): AgentJob | undefined {
  return transaction(() => {
    const job = db
      .prepare(
        "SELECT j.id,j.task_id,j.version,j.attempts FROM agent_jobs j JOIN task_plans p ON p.task_id=j.task_id AND p.version=j.version WHERE (j.status='pending' AND j.next_run<=?) OR (j.status='running' AND j.locked_until<?) ORDER BY j.created_at LIMIT 1",
      )
      .get(Date.now(), Date.now()) as AgentJob | undefined;
    if (!job) return undefined;
    db.prepare(
      "UPDATE agent_jobs SET status='running',owner=?,locked_until=?,attempts=attempts+1 WHERE id=?",
    ).run(owner, Date.now() + 90000, job.id);
    return { ...job, attempts: job.attempts + 1 };
  });
}
logOperation({ operation: "worker.start", code: "OK", durationMs: 0 });
try {
  while (!stopping) {
    if (!lease()) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    const job = claim();
    if (!job) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    const heartbeat = setInterval(() => {
      lease();
      db.prepare(
        "UPDATE agent_jobs SET locked_until=? WHERE id=? AND owner=? AND status='running'",
      ).run(Date.now() + 90000, job.id, owner);
    }, 10000);
    const started = Date.now();
    let code = "OK";
    try {
      await runAgentJob(job);
      db.prepare(
        "UPDATE agent_jobs SET status='done',locked_until=0 WHERE id=? AND status='running' AND owner=?",
      ).run(job.id, owner);
    } catch (error) {
      code =
        error instanceof Superseded
          ? "SUPERSEDED"
          : error instanceof NoFreeTime
            ? "NO_FREE_TIME"
            : publicError(error).code;
      if (error instanceof Superseded) {
        db.prepare(
          "UPDATE agent_jobs SET status='cancelled',locked_until=0 WHERE id=? AND owner=?",
        ).run(job.id, owner);
      } else if (error instanceof NoFreeTime) {
        updatePlan(job.task_id, job.version, "needs_input", error.message);
        db.prepare(
          "UPDATE agent_jobs SET status='done',locked_until=0 WHERE id=? AND owner=?",
        ).run(job.id, owner);
      } else {
        const safe = publicError(error);
        const message = safe.message;
        const transient = safe.retryable;
        const retry = transient && job.attempts < 5;
        const delay = [2000, 8000, 30000, 120000][
          Math.min(job.attempts - 1, 3)
        ];
        updatePlan(
          job.task_id,
          job.version,
          "error",
          `${message}${retry ? ` Автоматический повтор через ${delay / 1000} с.` : ""}`,
        );
        db.prepare(
          "UPDATE agent_jobs SET status=?,error=?,next_run=?,locked_until=0 WHERE id=? AND status='running' AND owner=?",
        ).run(
          retry ? "pending" : "error",
          message,
          Date.now() + delay,
          job.id,
          owner,
        );
      }
    } finally {
      clearInterval(heartbeat);
      logOperation({
        operation: "worker.job",
        code,
        jobId: job.id,
        attempt: job.attempts,
        durationMs: Date.now() - started,
      });
    }
  }
} finally {
  db.prepare("DELETE FROM worker_lease WHERE id=1 AND owner=?").run(owner);
}
