/** A shared browser transport boundary: HTML/proxy failures never surface as JSON syntax errors. */
export async function requestJSON<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.any([
        AbortSignal.timeout(65000),
        ...(init.signal ? [init.signal] : []),
      ]),
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new Error(
      error instanceof Error && error.name === "TimeoutError"
        ? "Время ожидания истекло. Обновите данные перед повторным запросом."
        : "Нет связи с сервером. Проверьте подключение и повторите действие.",
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      `Сервер вернул нечитаемый ответ (HTTP ${response.status}). Повторите позже.`,
    );
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error(
      `Сервер вернул неожиданный ответ (HTTP ${response.status}). Повторите позже.`,
    );
  if (!response.ok)
    throw new Error(
      typeof data?.error === "string"
        ? data.error
        : `Не удалось выполнить запрос (HTTP ${response.status})`,
    );
  return data as T;
}

/** Invalidate synchronously on every mutation or mode change, before React effects run. */
export class RequestScope {
  private epoch = 0;
  private controllers = new Set<AbortController>();
  invalidate() {
    this.epoch++;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }
  begin() {
    const epoch = this.epoch;
    const controller = new AbortController();
    this.controllers.add(controller);
    return {
      cancel: () => controller.abort(),
      signal: controller.signal,
      isCurrent: () => epoch === this.epoch && !controller.signal.aborted,
      close: () => {
        this.controllers.delete(controller);
      },
    };
  }
}
