import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("server-only", () => ({}));
import { modelJSON } from "../src/lib/ai/provider";
import { treeSchema } from "../src/lib/domain";
import { scenarios } from "../src/lib/scenarios";
const schema = z.object({ text: z.string().min(1) });
beforeEach(() => {
  vi.stubEnv("AI_BASE_URL", "https://provider.invalid/v1");
  vi.stubEnv("AI_MODEL", "test-model");
  vi.stubEnv("AI_API_KEY", "test-secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("AI provider boundary (mock transport, no live inference)", () => {
  it("requires explicit configuration instead of inventing an answer", async () => {
    vi.stubEnv("AI_API_KEY", "");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(modelJSON("instruction", {}, schema)).rejects.toThrow(
      /подключите AI API/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("passes contextual data and validates structured model output", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: JSON.stringify(scenarios[0].tree) } },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await modelJSON(
      "tree instructions",
      { goal: "Экзамен" },
      treeSchema,
    );
    expect(result).toEqual(scenarios[0].tree);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe("https://provider.invalid/v1/chat/completions");
    expect(JSON.parse(init.body).messages[1].content).toContain("Экзамен");
    expect(init.redirect).toBe("error");
  });
  it.each(["not-json", '{"wrong":"shape"}'])(
    "rejects malformed output %s",
    async (content) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(
              JSON.stringify({ choices: [{ message: { content } }] }),
            ),
          ),
      );
      await expect(modelJSON("", {}, schema)).rejects.toThrow(
        /корректный ответ/,
      );
    },
  );
  it("does not expose provider error bodies or credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("secret-provider-debug-test-secret", { status: 401 }),
        ),
    );
    await expect(modelJSON("", {}, schema)).rejects.toThrow(
      "Не удалось получить корректный ответ AI. Данные сохранены, попробуйте ещё раз.",
    );
  });
  it("offers retry on timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError")),
    );
    await expect(modelJSON("", {}, schema)).rejects.toThrow(
      /не успела ответить/,
    );
  });
});
