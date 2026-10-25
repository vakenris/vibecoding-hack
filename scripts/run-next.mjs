import { spawn } from "node:child_process";
import nextEnv from "@next/env";

const command = process.argv[2] ?? "dev";
nextEnv.loadEnvConfig(process.cwd(), command === "dev");
const local = process.env.LIFEPILOT_MODE === "local";
const noProxy = [
  process.env.NO_PROXY,
  process.env.no_proxy,
  "localhost",
  "127.0.0.1",
  "::1",
]
  .filter(Boolean)
  .join(",");
const childEnv = {
  ...process.env,
  NODE_ENV: command === "dev" ? "development" : "production",
  NO_PROXY: noProxy,
  no_proxy: noProxy,
  // Node reads proxy support at startup; a child process is required after
  // loading .env.local. Loopback CalDAV traffic must stay on this computer.
  ...(process.env.HTTP_PROXY ||
  process.env.HTTPS_PROXY ||
  process.env.http_proxy ||
  process.env.https_proxy
    ? { NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY ?? "1" }
    : {}),
};
const args = process.argv.slice(3);
if (
  local &&
  args.some((arg) => arg.startsWith("-H") || arg.startsWith("--hostname"))
) {
  throw new Error(
    "Локальный режим всегда слушает 127.0.0.1; параметр hostname недоступен",
  );
}
const children = [];
let shuttingDown = false;
function stop(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
    process.exit(code);
  }, 1500).unref();
}
const next = spawn(
  "node_modules/.bin/next",
  [
    command,
    "--hostname",
    local ? "127.0.0.1" : "0.0.0.0",
    "--port",
    "3010",
    ...args,
  ],
  {
    stdio: "inherit",
    env: childEnv,
  },
);
children.push(next);
next.on("exit", (code) => stop(code ?? 1));
next.on("error", () => stop(1));
if (local) {
  const worker = spawn(
    process.execPath,
    ["--conditions=react-server", "--import", "tsx", "scripts/agent-worker.ts"],
    {
      stdio: "inherit",
      env: childEnv,
    },
  );
  children.push(worker);
  worker.on("exit", (code) => {
    if (!shuttingDown) stop(code || 1);
  });
  worker.on("error", () => stop(1));
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
