import { AppError } from "./errors";

export const localMode = () => process.env.LIFEPILOT_MODE === "local";
export const cloudConfigured = () =>
  Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
export const aiConfigured = () =>
  Boolean(
    process.env.AI_BASE_URL && process.env.AI_MODEL && process.env.AI_API_KEY,
  );

export function aiSettings() {
  if (!aiConfigured())
    throw new AppError(
      "AI_CONFIGURATION",
      "Для индивидуального разбора подключите AI API. Задача сохранена.",
      503,
    );
  let endpoint: URL;
  try {
    endpoint = new URL(
      process.env.AI_BASE_URL!.replace(/\/$/, "") + "/chat/completions",
    );
    if (
      !["https:", "http:"].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    )
      throw new Error();
    if (
      process.env.AI_JSON_MODE &&
      !["tool", "text"].includes(process.env.AI_JSON_MODE)
    )
      throw new Error();
  } catch {
    throw new AppError(
      "AI_CONFIGURATION",
      "Проверьте AI_BASE_URL и AI_JSON_MODE в настройках сервера.",
      503,
    );
  }
  const timeout = Number(process.env.AI_TIMEOUT_MS || 45000);
  const maxTokens = Number(process.env.AI_MAX_OUTPUT_TOKENS || 16000);
  if (
    !Number.isFinite(timeout) ||
    timeout < 1000 ||
    timeout > 60000 ||
    !Number.isInteger(maxTokens) ||
    maxTokens < 4000 ||
    maxTokens > 24000
  )
    throw new AppError(
      "AI_CONFIGURATION",
      "Проверьте AI_TIMEOUT_MS (1000–60000) и AI_MAX_OUTPUT_TOKENS (4000–24000).",
      503,
    );
  return {
    endpoint,
    timeout,
    maxTokens,
    useTool: process.env.AI_JSON_MODE === "tool",
  };
}
