import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

const dir = await mkdtemp(join(tmpdir(), "lifepilot-radicale-"));
const probe = createServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const url = `http://127.0.0.1:${port}`;
await writeFile(join(dir, "users"), "pilot:local-test-password\n", {
  mode: 0o600,
});
await writeFile(
  join(dir, "config"),
  `[server]\nhosts = 127.0.0.1:${port}\n[auth]\ntype = htpasswd\nhtpasswd_filename = ${join(dir, "users")}\nhtpasswd_encryption = plain\n[rights]\ntype = owner_only\n[storage]\nfilesystem_folder = ${join(dir, "collections")}\n[logging]\nlevel = warning\n`,
);
const server = spawn(
  process.env.RADICALE_BIN || "radicale",
  ["--config", join(dir, "config")],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let diagnostic = "";
server.stderr.on("data", (chunk) => {
  diagnostic = (diagnostic + chunk).slice(-2000);
});
server.on("error", () => {});
try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (server.exitCode !== null)
      throw new Error("Radicale завершился: " + diagnostic);
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) });
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!ready)
    throw new Error(
      "Radicale не запустился. Установите Radicale и задайте RADICALE_BIN при необходимости.",
    );
  const response = await fetch(`${url}/pilot/test/`, {
    method: "MKCALENDAR",
    headers: {
      Authorization: `Basic ${Buffer.from("pilot:local-test-password").toString("base64")}`,
      "Content-Type": "application/xml",
    },
    body: '<?xml version="1.0"?><C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:set><D:prop><D:displayname>LifePilot isolated test</D:displayname><C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set></D:prop></D:set></C:mkcalendar>',
  });
  if (!response.ok)
    throw new Error(
      `Не удалось создать тестовый календарь: ${response.status}`,
    );
  const test = spawn(
    "node_modules/.bin/vitest",
    ["run", "tests/caldav.integration.test.ts"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        LIFEPILOT_TEST_CALDAV: url,
        LOCAL_CALDAV_HTTP_URL: url,
      },
    },
  );
  const code = await new Promise((resolve) => test.on("exit", resolve));
  if (code) process.exitCode = Number(code);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
  await new Promise((resolve) => server.once("exit", resolve));
  await rm(dir, { recursive: true, force: true });
}
