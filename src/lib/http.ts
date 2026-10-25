import { z } from "zod";
import { AppError, publicError } from "./errors";

export async function limitedBody(
  source: Request | Response,
  limit: number,
  oversized = new AppError("PAYLOAD_TOO_LARGE", "Слишком большой запрос", 413),
) {
  const reader = source.body?.getReader();
  if (!reader) {
    if (Number(source.headers.get("content-length")) > limit) throw oversized;
    return new Uint8Array();
  }
  try {
    if (Number(source.headers.get("content-length")) > limit) throw oversized;
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw oversized;
      chunks.push(value);
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
export async function readJSON<T>(
  request: Request,
  schema: z.ZodType<T>,
  limit: number,
) {
  const bytes = await limitedBody(request, limit);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new AppError(
      "INVALID_JSON",
      "Запрос должен содержать корректный JSON",
      400,
    );
  }
  return schema.parse(value);
}
export function requestOrigin(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("host") || url.host;
  try {
    const browserURL = new URL(`${url.protocol}//${host}`);
    if (
      browserURL.host !== host ||
      browserURL.username ||
      browserURL.password ||
      browserURL.pathname !== "/"
    )
      throw new Error();
    return browserURL;
  } catch {
    throw new AppError("FORBIDDEN", "Недопустимый Host запроса", 403);
  }
}
export function assertSameOrigin(request: Request, mutation = true) {
  const expected = requestOrigin(request).origin;
  const origin = request.headers.get("origin");
  if (
    (mutation && origin !== expected) ||
    (origin && origin !== expected) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new AppError("FORBIDDEN", "Недопустимый источник запроса", 403);
}
export function logOperation(entry: {
  operation: string;
  code: string;
  durationMs: number;
  requestId?: string;
  jobId?: string;
  attempt?: number;
}) {
  console.log(JSON.stringify(entry));
}
export async function handleRequest(
  operation: string,
  fn: () => Promise<Response>,
) {
  const requestId = crypto.randomUUID();
  const started = Date.now();
  try {
    const response = await fn();
    response.headers.set("X-Request-Id", requestId);
    logOperation({
      operation,
      code: "OK",
      requestId,
      durationMs: Date.now() - started,
    });
    return response;
  } catch (error) {
    const safe = publicError(error);
    logOperation({
      operation,
      code: safe.code,
      requestId,
      durationMs: Date.now() - started,
    });
    return Response.json(
      {
        error: safe.message,
        code: safe.code,
        requestId,
        retryable: safe.retryable,
      },
      {
        status: safe.status,
        headers: { "X-Request-Id": requestId, "Cache-Control": "no-store" },
      },
    );
  }
}
export async function actionResult<T>(operation: string, fn: () => Promise<T>) {
  const requestId = crypto.randomUUID();
  const started = Date.now();
  try {
    const data = await fn();
    logOperation({
      operation,
      code: "OK",
      requestId,
      durationMs: Date.now() - started,
    });
    return { data, error: null, code: null, requestId, retryable: false };
  } catch (error) {
    const safe = publicError(error);
    logOperation({
      operation,
      code: safe.code,
      requestId,
      durationMs: Date.now() - started,
    });
    return {
      data: null,
      error: safe.message,
      code: safe.code,
      requestId,
      retryable: safe.retryable,
    };
  }
}
