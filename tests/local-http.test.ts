import { afterEach, describe, expect, it, vi } from "vitest";
import { assertLocalRequest, limitedBody } from "../src/lib/local/http";
import { validateCalendarURL } from "../src/lib/local/caldav";
afterEach(() => vi.unstubAllEnvs());
describe("local request and transport boundaries", () => {
  it("accepts the browser loopback Host when Next uses its internal hostname", () => {
    vi.stubEnv("LIFEPILOT_MODE", "local");
    const request = new Request("http://localhost:3010/api/local", {
      method: "POST",
      headers: { Host: "127.0.0.1:3010", Origin: "http://127.0.0.1:3010" },
    });
    expect(() => assertLocalRequest(request, true)).not.toThrow();
  });
  it("rejects cross-origin mutations and DNS rebinding hosts", () => {
    vi.stubEnv("LIFEPILOT_MODE", "local");
    expect(() =>
      assertLocalRequest(
        new Request("http://localhost:3010/api/local", {
          method: "POST",
          headers: { Host: "localhost:3010", Origin: "https://evil.invalid" },
        }),
        true,
      ),
    ).toThrow(/источник/);
    expect(() =>
      assertLocalRequest(
        new Request("http://localhost:3010/api/local", {
          headers: { Host: "evil.invalid:3010" },
        }),
      ),
    ).toThrow(/loopback/);
  });
  it("enforces an actual streamed body limit without trusting Content-Length", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      body: "x".repeat(100),
      headers: { "Content-Length": "1" },
    });
    await expect(limitedBody(request, 20)).rejects.toThrow(/большой/);
  });
  it("denies HTTP unless its exact loopback origin is explicitly configured", () => {
    vi.stubEnv("LOCAL_CALDAV_HTTP_URL", "");
    expect(() => validateCalendarURL("http://127.0.0.1:5232")).toThrow(/HTTPS/);
    vi.stubEnv("LOCAL_CALDAV_HTTP_URL", "http://127.0.0.1:5232");
    expect(validateCalendarURL("http://127.0.0.1:5232/pilot/").protocol).toBe(
      "http:",
    );
    expect(() => validateCalendarURL("http://127.0.0.1:5233")).toThrow(/HTTPS/);
    expect(() => validateCalendarURL("http://other.invalid:5232")).toThrow(
      /HTTPS/,
    );
    expect(() =>
      validateCalendarURL("https://user:password@example.invalid/"),
    ).toThrow(/без пароля/);
  });
});
