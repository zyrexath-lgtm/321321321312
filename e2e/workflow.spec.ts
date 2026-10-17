import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createFixture, W_NS } from "../tests/fixtures";
import { analyzeDocument } from "../src/document/engine";
import { DEFAULT_PROFILE } from "../src/document/profile";
import { strFromU8, unzipSync } from "fflate";
import AxeBuilder from "@axe-core/playwright";

const documentFile = {
  name: "Моя курсовая.docx",
  mimeType:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  buffer: Buffer.from(createFixture({ rich: false })),
};

test("real upload, individual fix, fix all, download and safe reset", async ({
  page,
}, testInfo) => {
  const consoleErrors: string[] = [];
  const externalRequests: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("request", (request) => {
    if (!["127.0.0.1", "localhost"].includes(new URL(request.url()).hostname))
      externalRequests.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Работа готова",
  );
  await page.screenshot({
    path: testInfo.outputPath("upload.png"),
    fullPage: true,
  });
  await page.locator("input[type=file]").setInputFiles(documentFile);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "формальностей",
  );
  await expect(page.getByRole("checkbox")).toHaveCount(6);
  await expect(page.locator(".issue-card")).toHaveCount(6);
  await expect(page.locator(".report-actionbar")).toBeInViewport({ ratio: 0.9 });
  await page.locator(".issue-fix").first().click();
  await expect(page.getByRole("checkbox")).toHaveCount(5);
  await page.getByRole("button", { name: /Исправить всё/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Теперь — в норме.",
  );
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.locator(".score-ring")).toHaveAttribute(
    "aria-label",
    "Оценка оформления 100 из 100",
  );
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать DOCX" }).first().click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("Моя курсовая_норма.docx");
  const corrected = new Uint8Array(await readFile((await download.path())!));
  expect(
    analyzeDocument(corrected, DEFAULT_PROFILE).issues.filter(
      (issue) => issue.fixable,
    ),
  ).toHaveLength(0);
  const xmlText = (bytes: Uint8Array) =>
    strFromU8(unzipSync(bytes)["word/document.xml"]).match(
      /<w:t\b[^>]*>[^<]*<\/w:t>/g,
    );
  expect(xmlText(corrected)).toEqual(xmlText(documentFile.buffer));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("completed.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Новый документ" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Работа готова",
  );
  const history = await page.evaluate(() =>
    localStorage.getItem("norma.history.v1"),
  );
  expect(history).toContain("Моя курсовая.docx");
  expect(history).not.toContain("Учебная работа:");
  await page.getByRole("button", { name: "Очистить историю" }).click();
  expect(
    await page.evaluate(() => localStorage.getItem("norma.history.v1")),
  ).toBeNull();
  expect(consoleErrors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test("corrupt and unsupported files show useful errors and allow recovery", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "Файл.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7"),
    });
  await expect(page.getByRole("alert")).toContainText(
    "Поддерживаются только файлы .docx",
  );
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "Сломанный.docx",
      mimeType: documentFile.mimeType,
      buffer: Buffer.from("not a zip"),
    });
  await expect(page.getByRole("alert")).toContainText(/повреждён|не DOCX/);
  await page.getByRole("button", { name: /Попробовать на примере/ }).click();
  await expect(page.locator(".report-file")).toContainText(
    "Пример учебной работы.docx",
  );
  await expect(page.getByRole("checkbox")).toHaveCount(6);
});

test("profile dialog persists custom requirements, supports keyboard and fits viewport", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page
    .getByRole("button", { name: /Настройки/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.getByLabel("Размер, пт").fill("13");
  await page.getByRole("button", { name: "Применить" }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: /Настройки/ })
    .first()
    .click();
  await expect(page.getByLabel("Размер, пт")).toHaveValue("13");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: /Настройки/ }).first(),
  ).toBeFocused();
  await page.locator("input[type=file]").setInputFiles(documentFile);
  await expect(page.locator(".report-stats")).toContainText("13 пт");
});

test("drag and drop uses the same real document pipeline", async ({ page }) => {
  await page.goto("/");
  const transfer = await page.evaluateHandle(
    ({ bytes, mime }) => {
      const data = new DataTransfer();
      data.items.add(
        new File([new Uint8Array(bytes)], "Перетащенная работа.docx", {
          type: mime,
        }),
      );
      return data;
    },
    { bytes: [...documentFile.buffer], mime: documentFile.mimeType },
  );
  await page.dispatchEvent(".upload-panel", "drop", { dataTransfer: transfer });
  await transfer.dispose();
  await expect(page.locator(".report-file")).toContainText(
    "Перетащенная работа.docx",
  );
  await expect(page.getByRole("checkbox")).toHaveCount(6);
});

test("deselected correction is excluded from the output", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles(documentFile);
  await expect(page.getByRole("checkbox")).toHaveCount(6);
  await page.getByRole("checkbox").first().uncheck();
  await page.getByRole("button", { name: /Исправить выбранное/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Теперь — в норме.",
  );
  await expect(page.getByRole("checkbox")).toHaveCount(1);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать DOCX" }).first().click();
  const download = await downloadEvent;
  const report = analyzeDocument(
    new Uint8Array(await readFile((await download.path())!)),
    DEFAULT_PROFILE,
  );
  expect(report.issues.filter((issue) => issue.fixable)).toHaveLength(1);
});

test("upload, settings and report have no automated WCAG AA violations", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const audit = () =>
    new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
  expect((await audit()).violations).toEqual([]);
  await page
    .getByRole("button", { name: /Настройки/ })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect((await audit()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await page.locator("input[type=file]").setInputFiles(documentFile);
  await expect(page.getByRole("checkbox")).toHaveCount(6);
  expect((await audit()).violations).toEqual([]);
});

test("a large document can be cancelled and replaced without stale results", async ({ page }) => {
  const large = createFixture({ rich: false, document: `<?xml version="1.0"?><w:document xmlns:w="${W_NS}"><w:body>${'<w:p><w:r><w:t>Текст для проверки больших документов.</w:t></w:r></w:p>'.repeat(20000)}</w:body></w:document>` });
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({ ...documentFile, name: "Большая работа.docx", buffer: Buffer.from(large) });
  await page.getByRole("button", { name: /Отменить проверку|Новый документ/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Работа готова");
  await page.locator("input[type=file]").setInputFiles(documentFile);
  await expect(page.locator(".report-file")).toContainText("Моя курсовая.docx");
  await expect(page.getByRole("checkbox")).toHaveCount(6);
  await expect(page.locator(".report-stats")).not.toContainText("20000");
});
