import { test, expect, type Page, type TestInfo } from "@playwright/test";

async function check(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
  });
  const overflow = await page.evaluate(() => ({
    ok: document.documentElement.scrollWidth <= innerWidth,
    elements: Array.from(document.querySelectorAll("body *"))
      .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 12)
      .map((el) => ({
        class: el.className,
        right: el.getBoundingClientRect().right,
      })),
  }));
  expect(overflow.ok, `${name}: ${JSON.stringify(overflow.elements)}`).toBe(
    true,
  );
  if (await page.evaluate(() => innerWidth <= 390)) {
    const smallInputs = await page
      .locator(
        'input:visible:not([type="checkbox"]):not([type="radio"]), textarea:visible, select:visible',
      )
      .evaluateAll((inputs) =>
        inputs
          .filter((input) => parseFloat(getComputedStyle(input).fontSize) < 16)
          .map(
            (input) =>
              input.getAttribute("aria-label") ||
              input.getAttribute("name") ||
              input.tagName,
          ),
      );
    expect(smallInputs, `${name}: mobile inputs below 16px`).toEqual([]);
  }
  // Visible controls must have a nonempty accessible name, including icon-only actions.
  const unnamed = await page
    .locator("button:visible")
    .evaluateAll(
      (buttons) =>
        buttons.filter(
          (button) =>
            !button.textContent?.trim() &&
            !button.getAttribute("aria-label") &&
            !button.getAttribute("title"),
        ).length,
    );
  expect(unnamed, `${name}: accessible controls`).toBe(0);
}
for (const width of [360, 390, 768, 1024, 1440]) {
  test(`readable layouts at ${width}px and enlarged text`, async ({
    page,
  }, info) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await check(page, info, "login");
    await page.getByRole("button", { name: "Попробовать демо" }).click();
    await page.getByLabel("Как к тебе обращаться?").fill("Саша Alex");
    await check(page, info, "onboarding");
    await page.getByRole("button", { name: "В моё пространство" }).click();
    await expect(
      page.getByRole("heading", { name: "Привет, Саша." }),
    ).toBeVisible();
    for (const scale of [1, 1.25, 2]) {
      await page.evaluate((scale) => {
        document.documentElement.style.fontSize = `${16 * scale}px`;
      }, scale);
      await page.getByRole("button", { name: "Главная", exact: true }).click();
      await check(page, info, `home-${scale}`);
      if (width <= 390) {
        expect(
          await page
            .getByLabel("Твой вопрос или проблема")
            .evaluate((input) => parseFloat(getComputedStyle(input).fontSize)),
        ).toBeGreaterThanOrEqual(16);
      }
      for (const [button, heading] of [
        ["Мои задачи", "Мои задачи"],
        ["Идеи", "Идеи для тебя"],
        ["Настройки", "Настройки"],
      ]) {
        await page.getByRole("button", { name: button, exact: true }).click();
        await expect(
          page.getByRole("heading", { name: heading, exact: true }),
        ).toBeVisible();
        await check(page, info, `${button}-${scale}`);
      }
      await page
        .getByRole("button", { name: "Мои задачи", exact: true })
        .click();
      await page
        .getByRole("button", { name: /Подготовиться к экзамену/ })
        .click();
      await check(page, info, `tree-${scale}`);
      await page
        .getByRole("button", { name: "Наставник", exact: true })
        .click();
      await page
        .getByLabel("Сообщение наставнику")
        .fill(
          `Как выполнить шаг? ${"https://example.org/" + "длинныйURLandText".repeat(25)}`,
        );
      await page.getByRole("button", { name: "Отправить сообщение" }).click();
      await check(page, info, `mentor-${scale}`);
      await page
        .getByRole("button", { name: "Настройки", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Удалить демо-данные", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await check(page, info, `dialog-${scale}`);
      await page.getByRole("button", { name: "Отмена", exact: true }).click();
    }
    // Cyrillic and Latin variants are local font files; both must actually load.
    expect(
      await page.evaluate(() =>
        document.fonts.check("500 14px Manrope", "Привет Alex"),
      ),
    ).toBe(true);
  });
}
