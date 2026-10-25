import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as netServer } from "node:net";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { scenarios } from "../src/lib/scenarios";
import { mutateLocalState } from "../src/lib/local/state";
import { database } from "../src/lib/local/database";
nextEnv.loadEnvConfig(process.cwd());
const live = process.argv.includes("--live");
async function port() {
  const server = netServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const value = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return value;
}
const dir = await mkdtemp(join(tmpdir(), "lifepilot-full-"));
const davPort = await port(),
  appPort = await port();
const dav = `http://127.0.0.1:${davPort}`,
  app = `http://127.0.0.1:${appPort}`;
const children: ChildProcess[] = [];
let holdNextModelRequest = false;
let injectTransientFailure = !live;
let injectedFailures = 0;
let modelRequestHeld: (() => void) | undefined;
let diagnostics = "";
function start(command: string, args: string[], env = process.env) {
  const child = spawn(command, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  child.stdout?.on("data", (chunk) => {
    diagnostics = (diagnostics + chunk).slice(-4000);
  });
  child.stderr?.on("data", (chunk) => {
    diagnostics = (diagnostics + chunk).slice(-4000);
  });
  child.on("error", () => {});
  return child;
}
async function ready(url: string, child: ChildProcess) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null || !child.pid)
      throw new Error("Тестовый процесс не запустился: " + diagnostics);
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error("Не дождался сервера: " + diagnostics);
}
const model = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body),
    instruction = request.messages[0].content;
  const context = JSON.parse(
    request.messages[1].content.replace(/^USER_CONTEXT\n/, ""),
  );
  if (injectTransientFailure) {
    injectTransientFailure = false;
    injectedFailures++;
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: { code: 429, message: "isolated rate-limit fixture" },
      }),
    );
    return;
  }
  if (holdNextModelRequest) {
    holdNextModelRequest = false;
    modelRequestHeld?.();
    return;
  }
  let result;
  if (instruction.includes("Определи ОДНУ"))
    result = {
      title: "Подготовиться к экзамену",
      description: "Повторить темы и решить пробный вариант",
      deadline: "2026-11-03",
      deadlineSource: { location: "Абзац 1", quote: "Сдать до 2026-11-03" },
      requirements: [
        {
          text: "Повторить темы и решить пробный вариант",
          source: {
            location: "Абзац 1",
            quote: "Нужно повторить темы и решить пробный вариант.",
          },
        },
      ],
      clarification: null,
    };
  else if (instruction.includes("Создай конечные чек-листы")) {
    result = {
      plans: context.plans.map((plan: { leafId: string }) => ({
        leafId: plan.leafId,
        steps: scenarios[0].tree.nodes
          .find((node) => node.id === plan.leafId)!
          .steps.map((step) => ({ title: step.title, hint: step.hint })),
      })),
    };
  } else if (instruction.includes("Выбери ОДИН")) {
    result = {
      leafId: context.candidates[0].leafId,
      explanation:
        "Выбран путь самостоятельной подготовки с проверкой результата; пользовательские выборы сохранены.",
    };
  } else if (instruction.includes("Оцени длительность")) {
    result = {
      estimates: context.steps.map((step: { id: string }) => ({
        stepId: step.id,
        minutes: 30,
        preference: "any",
        businessHours: false,
      })),
    };
  } else result = scenarios[0].tree;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(result) } }],
    }),
  );
});
try {
  await writeFile(join(dir, "users"), "pilot:local-test-password\n", {
    mode: 0o600,
  });
  await writeFile(
    join(dir, "config"),
    `[server]\nhosts = 127.0.0.1:${davPort}\n[auth]\ntype = htpasswd\nhtpasswd_filename = ${join(dir, "users")}\nhtpasswd_encryption = plain\n[rights]\ntype = owner_only\n[storage]\nfilesystem_folder = ${join(dir, "collections")}\n[logging]\nlevel = warning\n`,
  );
  const radicale = start(process.env.RADICALE_BIN || "radicale", [
    "--config",
    join(dir, "config"),
  ]);
  await ready(dav, radicale);
  const mk = await fetch(`${dav}/pilot/test/`, {
    method: "MKCALENDAR",
    headers: {
      Authorization: `Basic ${Buffer.from("pilot:local-test-password").toString("base64")}`,
      "Content-Type": "application/xml",
    },
    body: '<?xml version="1.0"?><C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:set><D:prop><D:displayname>LifePilot isolated test</D:displayname><C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set></D:prop></D:set></C:mkcalendar>',
  });
  if (!mk.ok) throw new Error(`MKCALENDAR: ${mk.status}`);
  let modelEnv = {};
  if (!live) {
    await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
    modelEnv = {
      AI_BASE_URL: `http://127.0.0.1:${(model.address() as { port: number }).port}/v1`,
      AI_API_KEY: "mock-key",
      AI_MODEL: "deterministic-test",
    };
  } else if (!(
    process.env.AI_BASE_URL &&
    process.env.AI_MODEL &&
    process.env.AI_API_KEY
  ))
    throw new Error("Для живого smoke нужна настроенная модель");
  const env = {
    ...process.env,
    LIFEPILOT_MODE: "local",
    LOCAL_DATA_DIR: join(dir, "data"),
    LOCAL_CALDAV_HTTP_URL: dav,
    ...modelEnv,
  };
  const server = start(
    process.execPath,
    ["scripts/run-next.mjs", "start", "--port", String(appPort)],
    env,
  );
  await ready(app, server);
  if (live) {
    const post = async (body: unknown) => {
      const response = await fetch(`${app}/api/local`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: app },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      return result;
    };
    await post({
      action: "connect",
      url: dav,
      username: "pilot",
      password: "local-test-password",
    });
    process.env.LOCAL_DATA_DIR = env.LOCAL_DATA_DIR;
    const id = randomUUID();
    mutateLocalState({
      type: "scenario",
      id,
      scenarioId: scenarios[0].id,
      date: "",
    });
    async function waitPlan(complete: boolean) {
      const until = Date.now() + 150000;
      while (Date.now() < until) {
        const result = await (await fetch(`${app}/api/local`)).json();
        const plan = result.local.plans.find(
          (p: { taskId: string }) => p.taskId === id,
        );
        if (plan?.phase === "error" || plan?.phase === "needs_input") {
          const job = database()
            .prepare(
              "SELECT attempts,status FROM agent_jobs WHERE task_id=? ORDER BY version DESC LIMIT 1",
            )
            .get(id) as { attempts: number; status: string } | undefined;
          const waitingForRetry =
            plan.phase === "error" &&
            job?.status === "pending" &&
            (job?.attempts ?? 2) < 2;
          if (!waitingForRetry)
            throw new Error(`Живой smoke: ${plan.phase}: ${plan.message}`);
        }
        const events = result.local.events.filter(
          (e: { taskId: string; status: string }) =>
            e.taskId === id && e.status === "active",
        );
        if (
          plan?.phase === "ready" &&
          (complete ? events.length === 0 : events.length >= 4)
        )
          return events.length;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error("Живой smoke превысил лимит 150 секунд");
    }
    const count = await waitPlan(false);
    mutateLocalState({ type: "setDone", taskId: id, done: true });
    await waitPlan(true);
    console.log(
      `LIVE_SMOKE_PASS: настроенная модель + Radicale; создано ${count} событий, после выполнения события удалены.`,
    );
  } else {
    const test = spawn(
      "node_modules/.bin/playwright",
      [
        "test",
        "tests/e2e/local.spec.ts",
        "--project=desktop",
        "--workers=1",
        "--output=test-results/local",
      ],
      {
        stdio: "inherit",
        env: {
          ...env,
          LIFEPILOT_E2E_URL: app,
          LIFEPILOT_E2E_LOCAL: "1",
          LIFEPILOT_TEST_CALDAV: dav,
        },
      },
    );
    const code = await new Promise<number | null>((resolve) =>
      test.on("exit", resolve),
    );
    if (code)
      throw new Error(
        `Браузерная проверка завершилась с кодом ${code}\n${diagnostics}`,
      );
    // Interrupt an actual in-flight model request and restart both processes.
    // The same durable job must resume without waiting for an abandoned lease.
    process.env.LOCAL_DATA_DIR = env.LOCAL_DATA_DIR;
    const retried = database()
      .prepare("SELECT id FROM agent_jobs WHERE attempts>=2 AND status='done'")
      .get();
    if (injectedFailures !== 1 || !retried)
      throw new Error(
        "Временная ошибка AI не завершилась успешным повтором задания",
      );
    console.log(
      "RETRY_PASS: типизированный HTTP 429 повторён обработчиком; задание завершено.",
    );
    holdNextModelRequest = true;
    const held = new Promise<void>((resolve) => {
      modelRequestHeld = resolve;
    });
    const taskId = randomUUID();
    mutateLocalState({
      type: "scenario",
      id: taskId,
      scenarioId: scenarios[0].id,
      date: "",
    });
    await Promise.race([
      held,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Не дождался запроса перед перезапуском")),
          15000,
        ),
      ),
    ]);
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
    const restarted = start(
      process.execPath,
      ["scripts/run-next.mjs", "start", "--port", String(appPort)],
      env,
    );
    await ready(app, restarted);
    let resumed = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const result = await (await fetch(`${app}/api/local`)).json();
      const plan = result.local.plans.find(
        (p: { taskId: string }) => p.taskId === taskId,
      );
      if (plan?.phase === "error")
        throw new Error(`Возобновление задания: ${plan.message}`);
      if (
        plan?.phase === "ready" &&
        result.local.events.filter(
          (e: { taskId: string; status: string }) =>
            e.taskId === taskId && e.status === "active",
        ).length >= 4
      ) {
        resumed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!resumed) throw new Error("Задание не возобновилось после перезапуска");
    console.log(
      "RESTART_PASS: прерванное задание возобновилось после перезапуска приложения и обработчика.",
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  for (const child of children.reverse()) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  }
  model.closeAllConnections();
  if (model.listening)
    await new Promise<void>((resolve) => model.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
}
