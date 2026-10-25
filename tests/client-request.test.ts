import { afterEach, expect, it, vi } from "vitest";
import { RequestScope, requestJSON } from "../src/lib/client-request";
afterEach(() => vi.unstubAllGlobals());
it("rejects stale results even after a new mutation has finished", () => {
  const scope = new RequestScope();
  const poll = scope.begin();
  scope.invalidate();
  const mutation = scope.begin();
  mutation.close();
  expect(poll.signal.aborted).toBe(true);
  expect(poll.isCurrent()).toBe(false);
  expect(mutation.isCurrent()).toBe(true);
  scope.invalidate();
  expect(mutation.isCurrent()).toBe(false);
});
it("does not expose proxy HTML as a JSON parse exception", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response("<html>private upstream</html>", { status: 502 }),
      ),
  );
  await expect(requestJSON("/api/local")).rejects.toThrow(
    "нечитаемый ответ (HTTP 502)",
  );
});
it("uses the server's safe error and normalizes network failures", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: "Лимит", code: "RATE_LIMITED" },
          { status: 429 },
        ),
      ),
  );
  await expect(requestJSON("/api/ai")).rejects.toThrow("Лимит");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new TypeError("private network details")),
  );
  await expect(requestJSON("/api/ai")).rejects.toThrow("Нет связи с сервером");
});
