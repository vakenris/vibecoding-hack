import { unlink } from "node:fs/promises";
import { database, transaction } from "./database";
import { documentPath } from "./documents";

export async function clearLocalProfile() {
  const documents = database().prepare("SELECT id FROM documents").all() as {
    id: string;
  }[];
  transaction(() => {
    // Fence in-flight model and CalDAV operations before removing local records.
    database().exec(
      "DELETE FROM calendar_connection; DELETE FROM task_plans; DELETE FROM tree_drafts; DELETE FROM agent_jobs; DELETE FROM documents; DELETE FROM event_links; DELETE FROM agent_log; DELETE FROM app_state; DELETE FROM local_settings;",
    );
  });
  await Promise.all(
    documents.map((document) =>
      unlink(documentPath(document.id)).catch(() => {}),
    ),
  );
}
