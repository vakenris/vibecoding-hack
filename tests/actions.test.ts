import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("../src/lib/supabase/server", () => ({
  requireUser: vi.fn(),
  supabaseServer: vi.fn(),
  supabaseAdmin: vi.fn(),
}));
vi.mock("../src/lib/store", () => ({ mutateState: vi.fn() }));
import { headers } from "next/headers";
import {
  dispatchCommand,
  loadState,
  authenticate,
  deleteAccount,
} from "../src/app/actions";
import { requireUser, supabaseServer } from "../src/lib/supabase/server";
import { mutateState } from "../src/lib/store";
import { AppError } from "../src/lib/errors";
import { emptyState } from "../src/lib/domain";
beforeEach(() => {
  vi.stubEnv("LIFEPILOT_MODE", "cloud");
  vi.mocked(headers).mockResolvedValue(
    new Headers({ Host: "localhost", Origin: "http://localhost" }) as Awaited<
      ReturnType<typeof headers>
    >,
  );
  vi.mocked(requireUser).mockResolvedValue({ user: { id: "u" } } as Awaited<
    ReturnType<typeof requireUser>
  >);
  vi.mocked(mutateState).mockResolvedValue(emptyState());
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it.each([loadState, deleteAccount])(
  "requires an authenticated user for private actions",
  async (action) => {
    vi.mocked(requireUser).mockRejectedValueOnce(
      new AppError("UNAUTHORIZED", "Войдите в аккаунт", 401),
    );
    expect(await action()).toMatchObject({
      data: null,
      code: "UNAUTHORIZED",
      requestId: expect.any(String),
    });
    expect(mutateState).not.toHaveBeenCalled();
  },
);
it("does not accept trusted AI commands through a public action", async () => {
  expect(await dispatchCommand({ type: "reserveAI" })).toMatchObject({
    code: "INVALID_REQUEST",
  });
  expect(mutateState).not.toHaveBeenCalled();
});
it("preserves successful action data", async () => {
  const result = await dispatchCommand({ type: "clearHistory" });
  expect(result.data).toEqual(emptyState());
  expect(result.error).toBeNull();
  expect(mutateState).toHaveBeenCalledWith("u", { type: "clearHistory" });
});
it("hides unexpected storage exceptions", async () => {
  vi.mocked(mutateState).mockRejectedValueOnce(
    new Error("private database password"),
  );
  const result = await dispatchCommand({ type: "clearHistory" });
  expect(result).toMatchObject({ code: "INTERNAL_ERROR", retryable: true });
  expect(JSON.stringify(result)).not.toContain("password");
});
it("denies local actions from a non-loopback Host before opening storage", async () => {
  vi.stubEnv("LIFEPILOT_MODE", "local");
  vi.mocked(headers).mockResolvedValue(
    new Headers({
      Host: "evil.invalid",
      Origin: "http://evil.invalid",
    }) as Awaited<ReturnType<typeof headers>>,
  );
  expect(await loadState()).toMatchObject({ code: "FORBIDDEN" });
});
it("validates auth input before contacting Supabase", async () => {
  expect(
    await authenticate({ mode: "signup", email: "invalid", password: "x" }),
  ).toMatchObject({ code: "INVALID_REQUEST" });
  expect(supabaseServer).not.toHaveBeenCalled();
});
