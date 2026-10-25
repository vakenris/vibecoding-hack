import { test, expect, type Page } from "@playwright/test";
async function enter(page: Page, proactive = false) {
  await page.goto("/");
  await page.getByRole("button", { name: "Попробовать демо" }).click();
  await page.getByLabel("Как к тебе обращаться?").fill("Саша");
  await page.getByRole("button", { name: "В моё пространство" }).click();
  await expect(
    page.getByRole("heading", { name: "Привет, Саша." }),
  ).toBeVisible();
  if (proactive) {
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    await page.getByRole("switch").first().check();
    await page.getByRole("button", { name: "Сохранить настройки" }).click();
    await page.getByRole("button", { name: "Главная", exact: true }).click();
  }
}
async function openScenario(page: Page, title: string) {
  await page.getByRole("button", { name: "Мои задачи" }).click();
  await page.getByRole("button", { name: new RegExp(title) }).click();
}
test("two scenarios, feedback and persistence", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await enter(page, true);
  await openScenario(page, "Подготовиться к экзамену");
  await page.getByRole("button", { name: /Готовиться самостоятельно/ }).click();
  await page.getByRole("button", { name: /Есть неделя или больше/ }).click();
  await expect(
    page.getByRole("heading", { name: "Теперь — по шагам" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Наставник" }).click();
  await page.getByLabel("Сообщение наставнику").fill("С чего начать?");
  await page.getByRole("button", { name: "Отправить сообщение" }).click();
  await expect(
    page.getByText(/Ближайшее действие: Собрать список тем/),
  ).toBeVisible();
  for (const title of [
    "Собрать список тем",
    "Распределить темы по дням",
    "Пройти пробный вариант",
  ])
    await page.getByRole("button", { name: `Выполнено: ${title}` }).click();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "100",
  );
  await page
    .getByLabel("Что получилось и что было сложно?")
    .fill("Разобрал сложные темы");
  await page.getByRole("button", { name: "Сохранить результат" }).click();
  await expect(
    page.getByRole("heading", { name: "Результат сохранён" }),
  ).toBeVisible();
  await openScenario(page, "Первая самостоятельная стирка");
  await page.getByRole("button", { name: /В стиральной машине/ }).click();
  await page.getByRole("button", { name: /Обычные повседневные вещи/ }).click();
  for (const title of [
    "Проверить ярлыки и карманы",
    "Выбрать режим по ярлыку",
    "Добавить средство и запустить стирку",
  ])
    await page.getByRole("button", { name: `Выполнено: ${title}` }).click();
  await page.getByRole("button", { name: "Сохранить результат" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Попробовать демо" }).click();
  await page
    .getByRole("button", { name: "Открыть мой профиль", exact: true })
    .click();
  await expect(page.getByText("100 баллов")).toBeVisible();
  await expect(
    page.getByText("Делаю самостоятельно", { exact: true }),
  ).toHaveCount(2);
  await expect(page.getByText("Получено", { exact: true })).toHaveCount(2);
  expect(errors).toEqual([]);
});
test("calendar only filters dates and tasks come from the main question", async ({
  page,
}) => {
  await enter(page);
  const day = page
    .locator(".calendar-day")
    .filter({ has: page.locator(".day-dots i") })
    .first();
  await day.click();
  await expect(page.getByText("Выбранный день", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Мои задачи" }).click();
  await expect(
    page.getByRole("button", { name: "Добавить задачу", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Главная", exact: true }).click();
  await page
    .getByLabel("Твой вопрос или проблема")
    .fill("Записаться в библиотеку");
  await page.getByRole("button", { name: "Разобрать", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Сфера жизни" })
    .selectOption("career");
  await page.getByRole("button", { name: "Ко всем задачам" }).click();
  await page
    .getByRole("combobox", { name: "Сортировка задач" })
    .selectOption("date");
  await expect(page.locator(".task-row").last()).toContainText(
    "Записаться в библиотеку",
  );
  await page
    .getByRole("combobox", { name: "Сортировка задач" })
    .selectOption("created");
  await expect(page.locator(".task-row").first()).toContainText(
    "Записаться в библиотеку",
  );
  await page.getByRole("textbox", { name: "Найти задачу" }).fill("библиотеку");
  await expect(page.locator(".task-row")).toHaveCount(1);
  await expect(page.locator(".task-row")).toContainText("Учёба и карьера");
});
test("custom problem waits for live AI and never pretends to generate a tree", async ({
  page,
}) => {
  await enter(page);
  await page
    .getByLabel("Твой вопрос или проблема")
    .fill("Как выбрать район для переезда?");
  await page.getByRole("button", { name: "Разобрать", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Как выбрать район для переезда?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Построить дерево решений" }),
  ).toBeDisabled();
  await expect(page.getByText(/Индивидуальное дерево требует/)).toBeVisible();
  await page.getByRole("button", { name: "Идеи", exact: true }).click();
  await expect(
    page.getByText("Подумать о покупке квартиры", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".scenario-card")).toHaveCount(6);
});
test("responsive visual checkpoints have no horizontal overflow", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.screenshot({
    path: testInfo.outputPath("login.png"),
    fullPage: true,
  });
  await enter(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("home.png"),
    fullPage: true,
  });
  await openScenario(page, "Подготовиться к экзамену");
  await page.getByRole("button", { name: /Готовиться самостоятельно/ }).click();
  await page.getByRole("button", { name: /Есть неделя или больше/ }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const tag = await page.locator(".detail-top-actions .tag").boundingBox();
  const date = await page.locator(".detail-date").boundingBox();
  expect(tag).not.toBeNull();
  expect(date).not.toBeNull();
  expect(
    Math.abs(tag!.y + tag!.height / 2 - (date!.y + date!.height / 2)),
  ).toBeLessThan(1);
  await page.screenshot({
    path: testInfo.outputPath("tree.png"),
    fullPage: true,
  });
});

test("consent can be disabled and history is cleared without deleting progress", async ({
  page,
}) => {
  await enter(page, true);
  await openScenario(page, "Подготовиться к экзамену");
  await page.getByRole("button", { name: "Наставник" }).click();
  await page.getByLabel("Сообщение наставнику").fill("Нужна помощь");
  await page.getByRole("button", { name: "Отправить сообщение" }).click();
  await expect(page.locator(".message")).toHaveCount(2);
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByRole("switch").first().uncheck();
  await page.getByRole("switch").last().uncheck();
  await page.getByRole("button", { name: "Сохранить настройки" }).click();
  await expect(
    page.getByRole("button", { name: "Проверить демо-событие" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Очистить историю" }).click();
  await openScenario(page, "Подготовиться к экзамену");
  await page.getByRole("button", { name: "Наставник" }).click();
  await expect(page.locator(".message")).toHaveCount(0);
  await page.getByRole("button", { name: "Главная", exact: true }).click();
  await expect(page.locator(".notice")).toHaveCount(0);
});
