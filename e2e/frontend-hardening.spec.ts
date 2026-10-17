import { test, expect } from "@playwright/test";
import { createFixture, W_NS } from "../tests/fixtures";

const documentFile = {
  name: "Новая работа.docx",
  mimeType:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  buffer: Buffer.from(createFixture({ rich: false })),
};

test("cancelling during a delayed file read cannot resurrect the old document", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      if (this.name !== "Задержанный.docx") return original.call(this);
      return new Promise<ArrayBuffer>((resolve, reject) => {
        Object.assign(window, {
          releaseFileRead: () => original.call(this).then(resolve, reject),
        });
      });
    };
  });
  await page.goto("/");
  await page
    .locator("input[type=file]")
    .setInputFiles({ ...documentFile, name: "Задержанный.docx" });
  await expect(
    page.getByRole("button", { name: "Отменить проверку" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Отменить проверку" }).click();
  await page.locator("input[type=file]").setInputFiles(documentFile);
  await expect(page.locator(".report-file")).toContainText("Новая работа.docx");
  await page.evaluate(async () => {
    await (
      window as unknown as { releaseFileRead: () => Promise<void> }
    ).releaseFileRead();
  });
  await expect(page.locator(".report-file")).toContainText("Новая работа.docx");
  await expect(page.locator(".app")).toHaveClass("app stage-analysis");
  expect(
    await page.evaluate(() => localStorage.getItem("norma.history.v1")),
  ).not.toContain("Задержанный");
});

test("settings make the background inert and restore keyboard focus", async ({
  page,
}) => {
  await page.goto("/");
  const settings = page.getByRole("button", { name: /Настройки/ }).first();
  await settings.click();
  const close = page.getByRole("button", { name: "Закрыть настройки" });
  const apply = page.getByRole("button", { name: "Применить" });
  await expect(close).toBeFocused();
  expect(
    await page
      .locator("header, main, footer")
      .evaluateAll((elements) =>
        elements.every((element) => (element as HTMLElement).inert),
      ),
  ).toBe(true);
  await page
    .locator(".brand")
    .evaluate((element) => (element as HTMLElement).focus());
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(apply).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(settings).toBeFocused();
  expect(
    await page
      .locator("header, main, footer")
      .evaluateAll((elements) =>
        elements.every((element) => !(element as HTMLElement).inert),
      ),
  ).toBe(true);
});

test("untrusted persisted history cannot render invalid metadata", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const entries = [
      { name: "Корректная работа.docx", date: 1, score: 70, issues: 3 },
      { name: "Отрицательная оценка", date: 1, score: -20, issues: 1 },
      {
        name: "Будущее",
        date: Date.now() + 86400000 * 7,
        score: 100,
        issues: 1,
      },
      { name: "Слишком много замечаний", date: 1, score: 100, issues: -2 },
      { name: "Бесконечность", date: 1, score: "infinite", issues: 1 },
      { name: "x".repeat(1024), date: 1, score: 1, issues: 1 },
    ];
    localStorage.setItem(
      "norma.history.v1",
      JSON.stringify(entries).replace('"infinite"', "1e309"),
    );
  });
  await page.goto("/");
  await expect(page.locator(".history-item")).toHaveCount(1);
  await expect(page.locator(".history-item")).toContainText(
    "Корректная работа.docx",
  );
  await expect(page.locator(".history-item")).not.toContainText("Invalid Date");
});

test("blocked browser storage does not prevent settings or real document processing", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage unavailable", "SecurityError");
      },
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: /Настройки/ })
    .first()
    .click();
  await page.getByLabel("Размер, пт").fill("13");
  await page.getByRole("button", { name: "Применить" }).click();
  await expect(page.locator(".toast")).toContainText(
    "Браузер не разрешил сохранить профиль",
  );
  await page.locator("input[type=file]").setInputFiles(documentFile);
  await expect(page.locator(".report-stats")).toContainText("13 пт");
  await expect(page.locator(".report-file")).toContainText(documentFile.name);
  await page.getByRole("button", { name: "Новый документ" }).click();
  await expect(page.locator(".toast")).toHaveCount(0);
});

test("a document with no safely checkable parameters never receives a perfect score", async ({
  page,
}) => {
  const document = `<?xml version="1.0"?><w:document xmlns:w="${W_NS}"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Заголовок для ручной проверки</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="100" w:h="100"/><w:pgMar w:top="10" w:right="10" w:bottom="10" w:left="10"/></w:sectPr></w:body></w:document>`;
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    ...documentFile,
    buffer: Buffer.from(createFixture({ document })),
  });
  await expect(page.locator(".score-ring")).toHaveAttribute(
    "aria-label",
    "Параметры не проверены",
  );
  await expect(page.locator(".score-ring strong")).toHaveText("—");
  await expect(page.locator(".coverage-note")).toContainText("Проверено 0 из");
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.getByRole("button", { name: "Основной текст" }).click();
  await expect(page.locator(".no-issues p")).toContainText(
    "частичная проверка",
  );
  await expect(page.locator(".category-check")).toHaveCount(0);
});
