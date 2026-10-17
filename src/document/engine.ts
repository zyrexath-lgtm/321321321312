import {
  zipSync,
  Zip,
  ZipDeflate,
  ZipPassThrough,
  type Zippable,
} from "fflate";
import type { AnalysisReport, FixResult, FormattingProfile } from "./types";
import { assertProfile } from "./profile";
import { parseDocument } from "./parser";
import { evaluateDocument } from "./rules";
import { applyRule } from "./transformer";
import { serializeXml } from "./xml";

/** zipSync internally flattens into {}, which cannot represent __proto__.
 * Its streaming API uses a file list and preserves that legal OPC part name. */
function writePackage(
  entries: Record<string, Uint8Array>,
  alreadyCompressedParts?: Set<string>,
): Uint8Array {
  if (Object.hasOwn(entries, "__proto__")) {
    const chunks: Uint8Array[] = [];
    const archive = new Zip((error, data) => {
      if (error) throw error;
      chunks.push(data);
    });
    for (const [path, content] of Object.entries(entries)) {
      const part = alreadyCompressedParts?.has(path)
        ? new ZipPassThrough(path)
        : new ZipDeflate(path, { level: 6 });
      archive.add(part);
      part.push(content, true);
    }
    archive.end();
    const output = new Uint8Array(
      chunks.reduce((size, chunk) => size + chunk.length, 0),
    );
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }
  const outputEntries: Zippable = Object.create(null);
  for (const [path, content] of Object.entries(entries))
    outputEntries[path] = alreadyCompressedParts?.has(path)
      ? [content, { level: 0 }]
      : content;
  return zipSync(outputEntries, { level: 6 });
}

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
  const output = writePackage(parsed.entries, parsed.alreadyCompressedParts);
  // Read the generated OPC package again, validating XML, ZIP sizes and checksums.
  const report = analyzeDocument(output, profile);
  return { bytes: output, report, fixedCount: selected.length };
}
