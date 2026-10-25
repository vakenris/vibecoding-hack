import { z } from "zod";

/** Only deliberately public messages cross the server boundary. */
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public retryable = false,
  ) {
    super(message);
    this.name = "AppError";
  }
}
export function publicError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof z.ZodError)
    return new AppError("INVALID_REQUEST", "Проверьте поля запроса", 400);
  return new AppError(
    "INTERNAL_ERROR",
    "Не удалось выполнить действие. Повторите позже.",
    500,
    true,
  );
}
