import { test, expect } from "@playwright/test";
test.skip(
  process.env.LIFEPILOT_E2E_LOCAL !== "1",
  "Runs against the isolated local profile and Radicale from npm run test:local",
);
test("local document → agent → calendar → completion and branch change", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Как к тебе обращаться?").fill("Саша");
  await page.getByRole("button", { name: "В моё пространство" }).click();
  await expect(
    page.getByRole("heading", { name: "Привет, Саша." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByLabel("URL сервера").fill(process.env.LIFEPILOT_TEST_CALDAV!);
  await page.getByLabel("Логин", { exact: true }).fill("pilot");
  await page
    .getByLabel("Пароль приложения", { exact: true })
    .fill("local-test-password");
  await page.getByRole("button", { name: "Проверить и подключить" }).click();
  await expect(page.getByText("Подключено", { exact: true })).toBeVisible();
  await expect(
    page.getByLabel("Пароль приложения", { exact: true }),
  ).toHaveValue("");
  await page.getByRole("button", { name: "Главная", exact: true }).click();
  await page
    .getByLabel("Твой вопрос или проблема")
    .fill("Подготовиться к экзамену");
  await page.getByLabel("Прикрепить документ").setInputFiles({
    name: "exam.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Подготовиться к экзамену. Сдать до 2026-11-03. Нужно повторить темы и решить пробный вариант.",
    ),
  });
  await page.getByRole("button", { name: "Разобрать" }).click();
  await expect(
    page.getByRole("heading", { name: "Готово", exact: true }),
  ).toBeVisible({ timeout: 45000 });
  await expect(
    page.getByRole("heading", { name: "Теперь — по шагам" }),
  ).toBeVisible();
  await expect(page.getByText(/Почему выбран этот путь/)).toBeVisible();
  await expect(page.getByText("Источник: exam.txt")).toBeVisible();
  const snapshot = async () =>
    await (await page.request.get("/api/local")).json();
  const first = await snapshot();
  const task = first.state.tasks[0];
  expect(
    first.local.events.filter(
      (event: { status: string }) => event.status === "active",
    ).length,
  ).toBeGreaterThanOrEqual(4);
  expect(JSON.stringify(first)).not.toContain("local-test-password");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Скачать документ" }).click();
  expect((await download).suggestedFilename()).toBe("exam.txt");
  await page.screenshot({
    path: testInfo.outputPath("local-agent-desktop.png"),
    fullPage: false,
  });
  const previousCount = first.local.events.length;
  await page
    .getByRole("button", { name: /^Выполнено:/ })
    .first()
    .click();
  await expect
    .poll(
      async () =>
        (await snapshot()).local.events.filter(
          (e: { status: string }) => e.status === "active",
        ).length,
      { timeout: 20000 },
    )
    .toBe(previousCount - 1);
  const taskCheck = page.getByRole("checkbox", {
    name: new RegExp(`^Сделано: ${task.title}`),
  });
  await taskCheck.click();
  await expect(taskCheck).toBeChecked();
  await expect
    .poll(async () => (await snapshot()).local.events.length, {
      timeout: 20000,
    })
    .toBe(0);
  await taskCheck.click();
  await expect(taskCheck).not.toBeChecked();
  await expect
    .poll(
      async () =>
        (await snapshot()).local.events.filter(
          (e: { status: string }) => e.status === "active",
        ).length,
      { timeout: 20000 },
    )
    .toBe(previousCount);
  const root = page.locator('.tree-level[data-level="0"]');
  await root.locator(".branch-card.not-selected").click();
  await expect
    .poll(
      async () => {
        const result = await snapshot();
        return (
          result.local.plans[0].phase === "ready" &&
          result.state.tasks[0].selected[result.state.tasks[0].tree.rootId] !==
            task.selected[task.tree.rootId]
        );
      },
      { timeout: 20000 },
    )
    .toBe(true);
  const changed = await snapshot();
  expect(
    changed.local.events.filter(
      (e: { status: string }) => e.status === "active",
    ).length,
  ).toBeGreaterThanOrEqual(4);
  expect(
    changed.local.events.some((e: { stepId: string }) =>
      first.local.events.some(
        (old: { stepId: string }) => old.stepId === e.stepId,
      ),
    ),
  ).toBe(false);
  await page
    .getByRole("button", { name: "Удалить вложение", exact: true })
    .click();
  await expect(page.getByText("Источник: exam.txt")).toHaveCount(0);
  expect((await snapshot()).state.tasks).toHaveLength(1);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Привет, Саша." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("local-settings-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("polling has one active request and cannot overwrite a completed mutation or reopen logout", async ({
  page,
}) => {
  test.setTimeout(30000);
  const old = await (await page.request.get("/api/local")).json();
  const task = old.state.tasks[0];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let active = 0;
  let peak = 0;
  let held = false;
  await page.route("**/api/local", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    active++;
    peak = Math.max(peak, active);
    if (held) {
      await route.continue();
      active--;
      return;
    }
    held = true;
    await gate;
    await route.fulfill({ json: old }).catch(() => {});
    active--;
  });
  await page.goto("/");
  await expect.poll(() => held).toBe(true);
  // Deliberately cross the 3s polling interval while a GET is held open.
  await page.waitForTimeout(3500);
  expect(peak).toBe(1);
  await page.getByRole("button", { name: "Мои задачи", exact: true }).click();
  const done = page.getByRole("checkbox", {
    name: `Сделано: ${task.title}`,
    exact: true,
  });
  await done.click();
  await expect(done).toBeChecked({ checked: !task.done });
  release();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/local")).json()).state.tasks.find(
          (t: { id: string }) => t.id === task.id,
        ).done,
    )
    .toBe(!task.done);
  await expect(done).toBeChecked({ checked: !task.done });
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Открыть локальный профиль" }),
  ).toBeVisible();
  await page.waitForTimeout(3500);
  await expect(
    page.getByRole("button", { name: "Открыть локальный профиль" }),
  ).toBeVisible();
});

test("an earlier deadline requires input and preserves already scheduled events", async ({
  page,
}) => {
  test.setTimeout(45000);
  await page.goto("/");
  await page.getByRole("button", { name: "Идеи", exact: true }).click();
  await page
    .locator(".scenario-card")
    .filter({
      has: page.getByRole("heading", {
        name: "Подготовиться к экзамену",
        exact: true,
      }),
    })
    .getByRole("button", { name: "Начать сценарий", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Готово", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  const snapshot = async () => (await page.request.get("/api/local")).json();
  const before = await snapshot();
  const taskId = before.state.tasks[0].id;
  const events = before.local.events.filter(
    (event: { taskId: string; status: string }) =>
      event.taskId === taskId && event.status === "active",
  );
  expect(events.length).toBeGreaterThanOrEqual(4);
  const deadline = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const response = await page.request.post("/api/local", {
    headers: { Origin: new URL(page.url()).origin },
    data: { action: "schedule", taskId, deadline },
  });
  expect(response.status()).toBe(200);
  await expect
    .poll(
      async () =>
        (await snapshot()).local.plans.find(
          (plan: { taskId: string }) => plan.taskId === taskId,
        )?.phase,
      { timeout: 15000 },
    )
    .toBe("needs_input");
  const after = await snapshot();
  expect(
    after.local.events.filter(
      (event: { taskId: string }) => event.taskId === taskId,
    ),
  ).toEqual(events);
  expect(
    after.local.plans.find((plan: { taskId: string }) => plan.taskId === taskId)
      .message,
  ).toContain("после срока");
});
