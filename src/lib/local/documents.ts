import { AppError } from "../errors";
import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink, readFile } from "node:fs/promises";
import { join } from "node:path";
import { applyCommand } from "../domain";
import { scenarios } from "../scenarios";
import { database, localDataDir, transaction } from "./database";
import { enqueuePlan, readLocalState, writeLocalState } from "./state";
import type { Phase, PlanMeta } from "./types";

export interface TextPart {
  location: string;
  text: string;
}
export interface DocumentRow {
  id: string;
  task_id: string;
  name: string;
  kind: string;
  size: number;
  status: string;
  extracted: string | null;
  error: string;
}
export function documentPath(id: string) {
  return join(localDataDir(), "documents", `${id}.bin`);
}
export function taskDocument(taskId: string) {
  return database()
    .prepare("SELECT * FROM documents WHERE task_id=?")
    .get(taskId) as DocumentRow | undefined;
}
export async function createDocument(
  buffer: Buffer,
  name: string,
  explanation: string,
) {
  if (!buffer.length || buffer.length > 5 * 1024 * 1024)
    throw new AppError(
      buffer.length ? "PAYLOAD_TOO_LARGE" : "INVALID_REQUEST",
      "Файл должен быть не пустым и не больше 5 МБ",
      buffer.length ? 413 : 400,
    );
  const kind = name.split(".").at(-1)?.toLowerCase();
  if (!["pdf", "docx", "txt"].includes(kind ?? ""))
    throw new AppError(
      "INVALID_REQUEST",
      "Поддерживаются только PDF, DOCX и TXT",
      400,
    );
  const id = randomUUID(),
    taskId = randomUUID();
  const safeName = name.replace(/[\x00-\x1f/\\]/g, "_").slice(0, 180);
  const dir = join(localDataDir(), "documents");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(documentPath(id), buffer, { mode: 0o600, flag: "wx" });
  try {
    transaction(() => {
      const state = applyCommand(
        readLocalState(),
        {
          type: "create",
          id: taskId,
          title:
            explanation.trim().slice(0, 200) ||
            `Разобрать ${safeName}`.slice(0, 200),
          description: explanation.trim(),
          source: "thought",
          date: "",
          time: "",
          reminder: true,
          category: "global",
        },
        scenarios,
      );
      state.tasks.find((task) => task.id === taskId)!.documentId = id;
      writeLocalState(state);
      database()
        .prepare(
          "INSERT INTO documents(id,task_id,name,kind,size,created_at) VALUES(?,?,?,?,?,?)",
        )
        .run(
          id,
          taskId,
          safeName,
          kind!,
          buffer.length,
          new Date().toISOString(),
        );
      enqueuePlan(taskId, { userContext: explanation });
    });
  } catch (error) {
    await unlink(documentPath(id));
    throw error;
  }
  return taskId;
}
export function extractDocument(document: DocumentRow): Promise<TextPart[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      join(process.cwd(), "scripts", "extract-document.mjs"),
      {
        workerData: { path: documentPath(document.id), kind: document.kind },
        resourceLimits: {
          maxOldGenerationSizeMb: 256,
          maxYoungGenerationSizeMb: 32,
          stackSizeMb: 8,
        },
      },
    );
    let finished = false;
    const finish = (error?: Error, pages?: TextPart[]) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve(pages!);
    };
    const timer = setTimeout(
      () => finish(new Error("Разбор документа превысил 30 секунд")),
      30000,
    );
    worker.once("message", (message: { error?: string; pages?: TextPart[] }) =>
      finish(
        message.error ? new Error(message.error) : undefined,
        message.pages,
      ),
    );
    worker.once("error", () =>
      finish(
        new Error("Не удалось разобрать документ в пределах лимита памяти"),
      ),
    );
    worker.once("exit", (code) => {
      if (!finished)
        finish(new Error(`Разбор документа прерван (код ${code})`));
    });
  });
}
export async function deleteDocument(id: string) {
  transaction(() => {
    const row = database()
      .prepare("SELECT task_id FROM documents WHERE id=?")
      .get(id) as { task_id: string } | undefined;
    if (!row) return;
    database().prepare("DELETE FROM documents WHERE id=?").run(id);
    database()
      .prepare("DELETE FROM tree_drafts WHERE task_id=?")
      .run(row.task_id);
    const state = readLocalState();
    const task = state.tasks.find((t) => t.id === row.task_id);
    if (task) {
      delete task.documentId;
      writeLocalState(state);
    }
    // Fence any parser/model response still in flight before dropping its source.
    const previous = database()
      .prepare("SELECT phase FROM task_plans WHERE task_id=?")
      .get(row.task_id) as { phase: Phase } | undefined;
    enqueuePlan(row.task_id);
    const plan = database()
      .prepare("SELECT meta FROM task_plans WHERE task_id=?")
      .get(row.task_id) as { meta: string };
    const meta = JSON.parse(plan.meta) as PlanMeta;
    meta.sourceRemoved = true;
    if (meta.goal)
      meta.goal = { ...meta.goal, requirements: [], deadlineSource: null };
    database()
      .prepare("UPDATE task_plans SET meta=? WHERE task_id=?")
      .run(JSON.stringify(meta), row.task_id);
    const wasWorking =
      previous &&
      [
        "queued",
        "extracting",
        "understanding",
        "tree",
        "choosing",
        "finding",
        "creating",
      ].includes(previous.phase);
    if (!wasWorking || !meta.goal) {
      const phase =
        task?.tree && previous && !wasWorking ? previous.phase : "needs_input";
      database()
        .prepare(
          "UPDATE agent_jobs SET status='cancelled' WHERE task_id=? AND status='pending'",
        )
        .run(row.task_id);
      database()
        .prepare("UPDATE task_plans SET phase=?,message=? WHERE task_id=?")
        .run(
          phase,
          task?.tree
            ? "Вложение удалено. Задача и расписание сохранены."
            : "Вложение удалено. Уточните цель задачи, чтобы продолжить.",
          row.task_id,
        );
    }
  });
  await unlink(documentPath(id)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}
export async function downloadDocument(id: string) {
  const row = database()
    .prepare("SELECT * FROM documents WHERE id=?")
    .get(id) as DocumentRow | undefined;
  if (!row) throw new AppError("NOT_FOUND", "Документ удалён", 404);
  try {
    return { row, data: await readFile(documentPath(id)) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new AppError("NOT_FOUND", "Документ недоступен", 404);
    throw error;
  }
}
