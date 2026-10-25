import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("native Chromium tab zoom at 125 and 200 percent", async ({
  baseURL,
}, info) => {
  test.setTimeout(60000);
  const dir = await mkdtemp(join(tmpdir(), "lifepilot-zoom-"));
  const extension = join(dir, "extension");
  await mkdir(extension);
  await writeFile(
    join(extension, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Isolated zoom test",
      version: "1.0",
      permissions: ["tabs"],
      background: { service_worker: "worker.js" },
    }),
  );
  await writeFile(
    join(extension, "worker.js"),
    "chrome.runtime.onInstalled.addListener(() => {});",
  );
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(join(dir, "profile"), {
      channel: "chromium",
      headless: true,
      viewport: null,
      deviceScaleFactor: undefined,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [
        "--window-size=1440,1000",
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    });
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const page = context.pages()[0];
    const cdp = await context.newCDPSession(page);
    async function capture(name: string) {
      // Capture the physical viewport directly: Playwright's fullPage clip can
      // crop native tab zoom to a fraction of the visible viewport.
      const { data } = await cdp.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
      });
      await writeFile(info.outputPath(name), Buffer.from(data, "base64"));
    }
    await page.goto(baseURL!);
    await page.getByRole("button", { name: "Попробовать демо" }).click();
    await page.getByLabel("Как к тебе обращаться?").fill("Саша");
    await page.getByRole("button", { name: "В моё пространство" }).click();
    const original = await page.evaluate(() => innerWidth);
    for (const factor of [1.25, 2]) {
      // chrome.tabs.setZoom changes the actual browser tab zoom, including reflow.
      await worker.evaluate(
        `(async () => { const [tab] = await chrome.tabs.query({active:true}); await chrome.tabs.setZoom(tab.id, ${factor}); })()`,
      );
      await expect
        .poll(() => page.evaluate(() => innerWidth))
        .toBeLessThan(original / factor + 3);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await capture(`home-zoom-${factor}.png`);
      await page
        .getByRole("button", { name: "Мои задачи", exact: true })
        .click();
      await page
        .getByRole("button", { name: /Подготовиться к экзамену/ })
        .click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await capture(`tree-zoom-${factor}.png`);
      await page.getByRole("button", { name: "Главная", exact: true }).click();
    }
  } finally {
    await context?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
