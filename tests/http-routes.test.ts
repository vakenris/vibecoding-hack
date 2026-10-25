import { afterAll, beforeAll, afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
vi.mock("server-only", () => ({}));
import { GET, POST } from "../src/app/api/local/route";
import { POST as upload } from "../src/app/api/local/documents/route";
import {
  GET as download,
  DELETE as remove,
} from "../src/app/api/local/documents/[id]/route";
let dir: string;
const origin = "http://localhost:3010";
const request = (body: string, extra = {}) =>
  new Request(`${origin}/api/local`, {
    method: "POST",
    headers: { Origin: origin, ...extra },
    body,
  });
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "lifepilot-routes-"));
  vi.stubEnv("LOCAL_DATA_DIR", dir);
  vi.stubEnv("LIFEPILOT_MODE", "local");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
afterEach(() => vi.restoreAllMocks());
it("uses 403 for origin/host/mode denial, including document downloads", async () => {
  const response = await POST(request("{}", { Origin: "http://evil.invalid" }));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    code: "FORBIDDEN",
    requestId: response.headers.get("x-request-id"),
  });
  const result = await download(
    new Request(`${origin}/file`, { headers: { Host: "evil.invalid" } }),
    { params: Promise.resolve({ id: crypto.randomUUID() }) },
  );
  expect(result.status).toBe(403);
});
it.each(["{", '{"action":"settings","settings":{"defaultMinutes":-1}}'])(
  "rejects malformed JSON and invalid schema",
  async (body) => {
    expect((await POST(request(body))).status).toBe(400);
  },
);
it("stops a chunked oversized request without Content-Length", async () => {
  let sent = 0;
  const cancel = vi.fn();
  const stream = new ReadableStream({
    pull(c) {
      if (sent++ < 4) c.enqueue(new Uint8Array(1024 * 1024));
      else c.close();
    },
    cancel,
  });
  const req = new Request(`${origin}/api/local`, {
    method: "POST",
    headers: { Origin: origin },
    body: stream,
    duplex: "half",
  } as RequestInit);
  expect((await POST(req)).status).toBe(413);
  expect(cancel).toHaveBeenCalled();
});
it("returns 404 for a missing task without queuing work", async () => {
  expect(
    (
      await POST(
        request(
          JSON.stringify({ action: "schedule", taskId: crypto.randomUUID() }),
        ),
      )
    ).status,
  ).toBe(404);
});
it("returns 404 for absent documents and repeated deletion succeeds", async () => {
  const context = { params: Promise.resolve({ id: crypto.randomUUID() }) };
  expect((await download(new Request(`${origin}/file`), context)).status).toBe(
    404,
  );
  expect(
    (
      await remove(
        new Request(`${origin}/file`, {
          method: "DELETE",
          headers: { Origin: origin },
        }),
        context,
      )
    ).status,
  ).toBe(200);
});
it("validates multipart requests and streams upload limits", async () => {
  expect((await upload(request("not multipart"))).status).toBe(400);
  expect(
    (await upload(request("", { "Content-Length": String(6 * 1024 * 1024) })))
      .status,
  ).toBe(413);
});
it("preserves the local snapshot response and private cache policy", async () => {
  const response = await GET(new Request(`${origin}/api/local`));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({
    state: { version: 1 },
    local: { documents: [] },
  });
});

it("requeues an in-flight plan when scheduling settings change", async () => {
  const { mutateLocalState, updatePlan } =
    await import("../src/lib/local/state");
  const { database } = await import("../src/lib/local/database");
  const id = crypto.randomUUID();
  mutateLocalState({ type: "scenario", id, scenarioId: "exam", date: "" });
  updatePlan(id, 1, "finding", "В работе");
  const response = await POST(
    request(JSON.stringify({ action: "settings", settings: {} })),
  );
  expect(response.status).toBe(200);
  expect(
    database()
      .prepare("SELECT version,phase FROM task_plans WHERE task_id=?")
      .get(id),
  ).toEqual({ version: 2, phase: "queued" });
});
