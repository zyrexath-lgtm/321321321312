import { zipSync } from "fflate";
import type { AnalysisReport, FixResult, FormattingProfile } from "./types";
import { assertProfile } from "./profile";
import { parseDocument } from "./parser";
import { evaluateDocument } from "./rules";
import { applyRule } from "./transformer";
import { serializeXml } from "./xml";

export type {
  AnalysisReport,
  FormattingProfile,
  Issue,
  FixResult,
  CategoryId,
} from "./types";

export function analyzeDocument(
  bytes: Uint8Array,
  profile: FormattingProfile,
): AnalysisReport {
  assertProfile(profile);
  return evaluateDocument(parseDocument(bytes), profile).report;
}

export function fixDocument(
  bytes: Uint8Array,
  profile: FormattingProfile,
  issueIds: string[],
): FixResult {
  assertProfile(profile);
  if (!Array.isArray(issueIds) || issueIds.some((id) => typeof id !== "string"))
    throw new Error(
      "Некорректный список исправлений. Повторите анализ документа.",
    );
  const parsed = parseDocument(bytes);
  const before = evaluateDocument(parsed, profile);
  const selectedIds = new Set(issueIds);
  const selected = before.matches.filter(
    (match) => match.issue.fixable && selectedIds.has(match.issue.id),
  );
  if (!selected.length)
    return { bytes: bytes.slice(), report: before.report, fixedCount: 0 };
  const originalText = parsed.document.documentElement!.textContent;
  for (const match of selected) applyRule(parsed, match, profile);
  if (parsed.document.documentElement!.textContent !== originalText)
    throw new Error(
      "Проверка сохранности текста не пройдена. Исходный файл не изменён.",
    );
  const after = evaluateDocument(parsed, profile);
  const outstanding = new Set(
    after.report.issues
      .filter((issue) => issue.fixable)
      .map((issue) => issue.id),
  );
  if (selected.some((match) => outstanding.has(match.issue.id)))
    throw new Error(
      "Не удалось безопасно применить все выбранные настройки. Исходный файл не изменён.",
    );
  parsed.entries[parsed.mainPath] = serializeXml(parsed.document);
  const output = zipSync(parsed.entries, { level: 6 });
  // Read the generated OPC package again, validating XML, ZIP sizes and checksums.
  const report = analyzeDocument(output, profile);
  return { bytes: output, report, fixedCount: selected.length };
}
