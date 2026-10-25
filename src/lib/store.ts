import "server-only";
import { AppError } from "./errors";
import {
  type AppState,
  type TrustedCommand,
  applyCommand,
  emptyState,
  stateSchema,
  normalizeState,
} from "./domain";
import { scenarios } from "./scenarios";
import { supabaseAdmin } from "./supabase/server";

export async function readState(
  userId: string,
): Promise<{ state: AppState; revision: number }> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("user_state")
    .select("state, revision")
    .eq("user_id", userId)
    .maybeSingle();
  if (error)
    throw new AppError(
      "STORAGE_UNAVAILABLE",
      "Не удалось загрузить данные. Проверьте подключение и миграции Supabase.",
      503,
      true,
    );
  if (data) {
    if (data.state.version !== 1)
      throw new AppError(
        "STATE_VERSION",
        "Неподдерживаемая версия данных",
        500,
      );
    const parsed = stateSchema.safeParse(data.state);
    if (!parsed.success)
      throw new AppError(
        "STATE_INVALID",
        "Сохранённые данные имеют неподдерживаемый формат",
        500,
      );
    return {
      state: normalizeState(parsed.data, scenarios),
      revision: data.revision,
    };
  }
  const state = emptyState();
  const { error: insertError } = await admin
    .from("user_state")
    .insert({ user_id: userId, state, revision: 0 });
  if (insertError?.code === "23505") return readState(userId);
  if (insertError)
    throw new AppError(
      "STORAGE_UNAVAILABLE",
      "Не удалось создать профиль. Проверьте миграции Supabase.",
      503,
      true,
    );
  return { state, revision: 0 };
}
export async function mutateState(
  userId: string,
  command: TrustedCommand,
): Promise<AppState> {
  const admin = supabaseAdmin();
  // A single conditional JSONB update commits the full domain transaction. Retry on concurrent writes.
  for (let attempt = 0; attempt < 5; attempt++) {
    const { state, revision } = await readState(userId);
    let updated = applyCommand(state, command, scenarios);
    if (
      command.type !== "tick" &&
      command.type !== "reserveAI" &&
      command.type !== "clearHistory"
    )
      updated = applyCommand(updated, { type: "tick", demo: false }, scenarios);
    const { data, error } = await admin
      .from("user_state")
      .update({
        state: updated,
        revision: revision + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("revision", revision)
      .select("revision");
    if (error)
      throw new AppError(
        "STORAGE_UNAVAILABLE",
        "Не удалось сохранить изменения. Повторите запрос.",
        503,
        true,
      );
    if (data?.length) return updated;
  }
  throw new AppError(
    "CONFLICT",
    "Данные изменились в другой вкладке. Повторите действие.",
    409,
    true,
  );
}
