import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("server-only", () => ({}));
import { modelJSON, generateTree } from "../src/lib/ai/provider";
import { treeSchema, emptyState } from "../src/lib/domain";
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
      await expect(modelJSON("", {}, schema)).rejects.toThrow(/JSON|схеме/);
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
      "Провайдер AI вернул HTTP 401. Проверьте настройки модели.",
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
  it("accepts an exact JSON fence while retaining schema validation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '```json\n{"text":"OK"}\n```' } }],
          }),
        ),
      ),
    );
    await expect(modelJSON("", {}, schema)).resolves.toEqual({ text: "OK" });
  });
  it("uses a forced result tool only when configured and parses its arguments", async () => {
    vi.stubEnv("AI_JSON_MODE", "tool");
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    function: {
                      name: "lifepilot_result",
                      arguments: '{"text":"OK"}',
                    },
                  },
                ],
              },
            },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(modelJSON("", {}, schema)).resolves.toEqual({ text: "OK" });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.tool_choice.function.name).toBe("lifepilot_result");
    expect(body.tools[0].function.parameters.properties.text.type).toBe(
      "string",
    );
  });
  it("reports a retryable provider error returned inside HTTP 200 without exposing its body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 502,
              message: "private provider debug test-secret",
            },
          }),
        ),
      ),
    );
    await expect(modelJSON("", {}, schema)).rejects.toMatchObject({
      temporary: true,
      message: "Провайдер AI вернул ошибку (код 502). Повторите запрос.",
    });
  });
});

it("requests a detailed tree with a sufficient output budget and rejects a shallow model response", async () => {
  const state = emptyState();
  const task = {
    id: "10000000-0000-4000-8000-000000000001",
    title: "Стирка",
    description: "",
    category: "home" as const,
    date: "",
    time: "",
    reminder: true,
    source: "thought" as const,
    selected: {},
    completed: [],
    createdAt: new Date().toISOString(),
    awarded: [],
  };
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(scenarios[1].tree) } }],
      }),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  await expect(
    generateTree(state, task, "Нужно выстирать деликатные вещи"),
  ).resolves.toEqual(scenarios[1].tree);
  const request = JSON.parse(fetch.mock.calls[0][1].body);
  expect(request.max_tokens).toBeGreaterThan(5000);
  expect(request.messages[0].content).toContain(
    "четыре последовательных решения",
  );
  expect(request.messages[0].content).toContain("30 °C");
  const shallow = {
    rootId: "root",
    nodes: [
      {
        id: "root",
        title: "Вопрос",
        pros: [],
        risks: [],
        children: ["leaf"],
        steps: [],
      },
      {
        id: "leaf",
        title: "Готово",
        pros: [],
        risks: [],
        children: [],
        steps: [{ id: "s", title: "Делать", hint: "Что-нибудь сделать" }],
      },
    ],
  };
  fetch.mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(shallow) } }],
      }),
    ),
  );
  await expect(
    generateTree(state, task, "Нужно выстирать вещи"),
  ).rejects.toThrow(/схеме/);
});

it("rejects token truncation even when the returned JSON is valid", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "length",
              message: { content: '{"text":"partial"}' },
            },
          ],
        }),
      ),
    ),
  );
  await expect(modelJSON("", {}, schema)).rejects.toMatchObject({
    temporary: true,
  });
});
it("makes timeouts retryable without matching error text", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValue(new DOMException("private details", "TimeoutError")),
  );
  await expect(modelJSON("", {}, schema)).rejects.toMatchObject({
    retryable: true,
    code: "AI_TIMEOUT",
    status: 504,
  });
});
it("validates endpoint credentials and protocol before sending secrets", async () => {
  vi.stubEnv("AI_BASE_URL", "ftp://user:password@example.invalid");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(modelJSON("", {}, schema)).rejects.toMatchObject({
    code: "AI_CONFIGURATION",
    status: 503,
  });
  expect(fetch).not.toHaveBeenCalled();
});
it("cancels an oversized response while it is being read", async () => {
  const cancel = vi.fn();
  let chunks = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (chunks++ < 4) controller.enqueue(new Uint8Array(100001));
      else controller.close();
    },
    cancel,
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
  await expect(modelJSON("", {}, schema)).rejects.toThrow(/размер/);
  expect(cancel).toHaveBeenCalled();
});

it("returns a retryable 429 for rate errors inside HTTP 200", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ error: { code: 429, message: "private debug" } }),
      ),
  );
  await expect(modelJSON("", {}, schema)).rejects.toMatchObject({
    code: "AI_RATE_LIMITED",
    status: 429,
    retryable: true,
  });
});

it("rejects blank recommendation titles before they can corrupt persisted state", async () => {
  const { recommendIdeas } = await import("../src/lib/ai/provider");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                ideas: [
                  {
                    title: "   ",
                    description: "",
                    reason: "",
                    category: "home",
                  },
                ],
              }),
            },
          },
        ],
      }),
    ),
  );
  await expect(recommendIdeas(emptyState())).rejects.toMatchObject({
    code: "AI_RESPONSE",
  });
});
