import { AppError } from "../errors";
import { localMode } from "../config";
import { assertSameOrigin, requestOrigin } from "../http";
export { limitedBody } from "../http";
export function assertLocalRequest(request: Request, mutation = false) {
  if (!localMode())
    throw new AppError(
      "FORBIDDEN",
      "Интеграции доступны только в локальном режиме",
      403,
    );
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(
      requestOrigin(request).hostname,
    )
  )
    throw new AppError(
      "FORBIDDEN",
      "Локальный профиль доступен только через loopback",
      403,
    );
  assertSameOrigin(request, mutation);
}
