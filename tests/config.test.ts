import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiSettings } from "../src/lib/config";

beforeEach(() => {
  vi.stubEnv("AI_BASE_URL", "https://provider.example/v1");
  vi.stubEnv("AI_MODEL", "test-model");
  vi.stubEnv("AI_API_KEY", "test-key");
  vi.stubEnv("AI_TIMEOUT_MS", "180000");
});

afterEach(() => vi.unstubAllEnvs());

describe("AI timeout limits", () => {
  it("allows a longer timeout for local worker jobs", () => {
    vi.stubEnv("LIFEPILOT_MODE", "local");
    expect(aiSettings().timeout).toBe(180000);
  });

  it("keeps cloud request timeouts within the route limit", () => {
    vi.stubEnv("LIFEPILOT_MODE", "cloud");
    expect(() => aiSettings()).toThrow(/AI_TIMEOUT_MS \(1000–60000\)/);
  });

  it("accepts a supported optional reasoning effort", () => {
    vi.stubEnv("LIFEPILOT_MODE", "local");
    vi.stubEnv("AI_REASONING_EFFORT", "low");
    expect(aiSettings().reasoningEffort).toBe("low");
  });

  it("rejects unknown reasoning effort values", () => {
    vi.stubEnv("LIFEPILOT_MODE", "local");
    vi.stubEnv("AI_REASONING_EFFORT", "turbo");
    expect(() => aiSettings()).toThrow(/AI_REASONING_EFFORT/);
  });
});
