import type { AnalysisReport, FormattingProfile, Issue } from "./types";
import type { ParsedDocument } from "./parser";
import { StyleResolver, hasComplexContent } from "./styles";
import {
  attr,
  child,
  children,
  descendants,
  paragraphText,
  type XmlElement,
} from "./xml";
import { cmToTwips, twipsToCm } from "./profile";

export interface RuleMatch {
  issue: Issue;
  paragraphs?: XmlElement[];
  runs?: XmlElement[];
  sections?: XmlElement[];
  impliedSection?: boolean;
}
export interface Evaluation {
  report: AnalysisReport;
  matches: RuleMatch[];
}
const matchesValue = (a: number | undefined, b: number, tolerance = 1) =>
  a !== undefined && Number.isFinite(a) && Math.abs(a - b) <= tolerance;
const cm = (n: number) => `${Number(n.toFixed(2)).toLocaleString("ru-RU")} см`;
const alignments: Record<string, string> = {
  both: "По ширине",
  left: "По левому краю",
  start: "По левому краю",
  center: "По центру",
  right: "По правому краю",
  end: "По правому краю",
  distribute: "Распределённое",
};
const sumDistinct = (values: string[]) =>
  [...new Set(values)].slice(0, 3).join(", ");

export function evaluateDocument(
  parsed: ParsedDocument,
  profile: FormattingProfile,
): Evaluation {
  const resolver = new StyleResolver(parsed.styles, parsed.theme);
  const allParagraphs = descendants(parsed.body, "p");
  const directParagraphs = children(parsed.body, "p");
  const matches: RuleMatch[] = [];
  const warnings = [...parsed.warnings];
  const eligible: XmlElement[] = [];
  const complexIndents: XmlElement[] = [];
  let protectedCount = 0,
    inReferences = false,
    fieldDepth = 0;
  const suspiciousHeadings: XmlElement[] = [];
  for (const p of directParagraphs) {
    const text = paragraphText(p).trim(),
      format = resolver.paragraph(p),
      style = resolver.styleName(p);
    const heading =
      /heading|title|subtitle|заголов|toc|оглав|caption|подпис/i.test(style) ||
      (format.outline !== undefined && format.outline < 9);
    const caption =
      /^(рис(унок|\.)?|таблица|табл\.|figure|table)\s*[\dIVX]/iu.test(text);
    if (
      /^(список\s+(использованн\w+\s+)?(литературы|источников)|библиографическ\w+\s+список|references|bibliography)\s*$/iu.test(
        text.replace(/^\d+[.\s]+/, ""),
      )
    )
      inReferences = true;
    else if (inReferences && heading) inReferences = false;
    let inField = fieldDepth > 0;
    for (const field of descendants(p, "fldChar")) {
      const kind = attr(field, "fldCharType");
      if (kind === "begin") fieldDepth++;
      if (kind === "end") fieldDepth = Math.max(0, fieldDepth - 1);
      inField = true;
    }
    const unsafe =
      hasComplexContent(p) ||
      inField ||
      heading ||
      caption ||
      inReferences ||
      (format.numbering !== undefined && format.numbering !== "0") ||
      format.bidi === true ||
      /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(text);
    if (text && unsafe) protectedCount++;
    if (!text || unsafe) continue;
    const normalizedTitle = text.replace(/\s+/g, " ");
    const commonSectionTitle =
      /^(введение|заключение|содержание|оглавление|аннотация|реферат|основная часть|список сокращений|перечень сокращений|литература|библиография|приложение(?:\s+[А-ЯЁA-Z0-9]+)?)[.:]?$/iu.test(normalizedTitle);
    const shortCenteredTitle =
      format.alignment === "center" &&
      normalizedTitle.length <= 140 &&
      normalizedTitle.split(" ").length <= 18 &&
      !/[.!?;]\s*$/.test(normalizedTitle);
    // Preserve likely headings and title-page lines without inventing hierarchy.
    if (
      commonSectionTitle ||
      shortCenteredTitle ||
      (/^\d+(?:\.\d+){0,3}[.)]?\s+[А-ЯЁA-Z]/u.test(text) &&
        text.length < 130 &&
        !/[.!?;:]\s*$/.test(text))
    ) {
      suspiciousHeadings.push(p);
      protectedCount++;
      continue;
    }
    eligible.push(p);
  }
  const paragraphsByRule = new Map<string, XmlElement[]>();
  const runsByRule = new Map<string, XmlElement[]>();
  const foundByRule = new Map<string, string[]>();
  const add = (
    id: string,
    p: XmlElement,
    found: string,
    runs?: XmlElement[],
  ) => {
    const ps = paragraphsByRule.get(id) ?? [];
    ps.push(p);
    paragraphsByRule.set(id, ps);
    const fs = foundByRule.get(id) ?? [];
    fs.push(found);
    foundByRule.set(id, fs);
    if (runs) {
      const targets = runsByRule.get(id) ?? [];
      for (const run of runs) targets.push(run);
      runsByRule.set(id, targets);
    }
  };
  for (const p of eligible) {
    const pFormat = resolver.paragraph(p);
    const runs = descendants(p, "r").filter((r) =>
      descendants(r, "t").some((t) => (t.textContent ?? "").trim()),
    );
    const wrongFonts = runs.filter(
      (r) =>
        resolver.run(p, r).font?.toLocaleLowerCase() !==
        profile.fontFamily.toLocaleLowerCase(),
    );
    const wrongSizes = runs.filter(
      (r) => !matchesValue(resolver.run(p, r).size, profile.fontSize, 0.01),
    );
    if (wrongFonts.length)
      add(
        "text.font",
        p,
        sumDistinct(
          wrongFonts.map(
            (r) => resolver.run(p, r).font || "Шрифт по умолчанию Word",
          ),
        ),
        wrongFonts,
      );
    if (wrongSizes.length)
      add(
        "text.size",
        p,
        sumDistinct(
          wrongSizes.map((r) =>
            resolver.run(p, r).size === undefined
              ? "Размер по умолчанию Word"
              : `${resolver.run(p, r).size} pt`,
          ),
        ),
        wrongSizes,
      );
    const spacing = pFormat.line ?? 240;
    if (
      (pFormat.lineRule && pFormat.lineRule !== "auto") ||
      !matchesValue(spacing, profile.lineSpacing * 240)
    ) {
      const current =
        pFormat.lineRule && pFormat.lineRule !== "auto"
          ? `${spacing / 20} pt (${pFormat.lineRule === "exact" ? "точно" : "минимум"})`
          : `${Number((spacing / 240).toFixed(2))}`;
      add("paragraph.spacing", p, current);
    }
    const hanging = pFormat.hanging ?? 0;
    const indent = hanging ? -hanging : (pFormat.firstLine ?? 0);
    if (
      pFormat.firstLineChars !== undefined ||
      pFormat.hangingChars !== undefined ||
      !matchesValue(indent, cmToTwips(profile.firstLineIndent))
    ) {
      const inherited = resolver.paragraph(p, false);
      if (
        inherited.firstLineChars !== undefined ||
        inherited.hangingChars !== undefined ||
        (inherited.hanging ?? 0) !== 0
      )
        complexIndents.push(p);
      else
        add(
          "paragraph.indent",
          p,
          pFormat.firstLineChars !== undefined ||
            pFormat.hangingChars !== undefined
            ? "Отступ в символах"
            : cm(twipsToCm(indent)),
        );
    }
    const alignment =
      pFormat.alignment === "start"
        ? "left"
        : pFormat.alignment === "end"
          ? "right"
          : (pFormat.alignment ?? "left");
    if (alignment !== profile.alignment)
      add("paragraph.alignment", p, alignments[alignment] || alignment);
  }
  const definitions = [
    [
      "text.font",
      "text",
      "Шрифт основного текста",
      profile.fontFamily,
      "Установим выбранный шрифт, сохранив выделения, ссылки и содержимое.",
    ],
    [
      "text.size",
      "text",
      "Размер шрифта",
      `${profile.fontSize} pt`,
      "Изменим размер букв в основном тексте. Формулы и специальные блоки пропускаются.",
    ],
    [
      "paragraph.spacing",
      "paragraphs",
      "Межстрочный интервал",
      `${profile.lineSpacing}`,
      "Приведём расстояние между строками к выбранному значению.",
    ],
    [
      "paragraph.indent",
      "paragraphs",
      "Отступ первой строки",
      cm(profile.firstLineIndent),
      "Зададим одинаковый абзацный отступ, сохранив отступы слева и справа.",
    ],
    [
      "paragraph.alignment",
      "paragraphs",
      "Выравнивание абзацев",
      alignments[profile.alignment],
      "Применим выравнивание к обычным абзацам основного текста.",
    ],
  ] as const;
  for (const [id, category, title, expected, description] of definitions) {
    const paragraphs = paragraphsByRule.get(id);
    if (!paragraphs?.length) continue;
    matches.push({
      issue: {
        id,
        ruleId: id,
        category,
        title,
        description: `${description} Абзацев: ${paragraphs.length}.`,
        found: sumDistinct(foundByRule.get(id)!),
        expected,
        count: paragraphs.length,
        fixable: true,
        severity: "warning",
      },
      paragraphs,
      runs: runsByRule.get(id),
    });
  }
  const sections = [
    ...children(parsed.body, "sectPr"),
    ...directParagraphs.flatMap((p) => {
      const section = child(child(p, "pPr"), "sectPr");
      return section ? [section] : [];
    }),
  ];
  const conflictsWithPage = (section: XmlElement) => {
    const size = child(section, "pgSz");
    const width = Number(attr(size, "w")),
      height = Number(attr(size, "h"));
    const gutter = Math.max(
      0,
      Number(attr(child(section, "pgMar"), "gutter") || 0),
    );
    return (
      (Number.isFinite(width) &&
        width > 0 &&
        cmToTwips(profile.margins.left) +
          cmToTwips(profile.margins.right) +
          gutter >=
          width) ||
      (Number.isFinite(height) &&
        height > 0 &&
        cmToTwips(profile.margins.top) +
          cmToTwips(profile.margins.bottom) +
          gutter >=
          height)
    );
  };
  const conflictingSections = sections.filter(conflictsWithPage);
  const safeSections = sections.filter(
    (section) => !child(section, "sectPrChange") && !conflictsWithPage(section),
  );
  const marginsWrong = (section?: XmlElement) =>
    (["left", "right", "top", "bottom"] as const).some(
      (k) =>
        !matchesValue(
          Number(attr(child(section, "pgMar"), k) ?? 1440),
          cmToTwips(profile.margins[k]),
        ),
    );
  const wrongSections = safeSections.filter(marginsWrong);
  const impliedSection = sections.length === 0 && marginsWrong();
  if (wrongSections.length || impliedSection) {
    const id = "page.margins";
    const first = child(wrongSections[0], "pgMar");
    matches.unshift({
      issue: {
        id,
        ruleId: id,
        category: "page",
        title: "Поля страницы",
        description:
          "Применим поля к разделам документа. Размер бумаги, колонтитулы и разрывы разделов сохраняются.",
        found: `Слева ${cm(twipsToCm(Number(attr(first, "left") ?? 1440)))}, справа ${cm(twipsToCm(Number(attr(first, "right") ?? 1440)))}`,
        expected: `Слева ${cm(profile.margins.left)}, справа ${cm(profile.margins.right)}, сверху и снизу ${cm(profile.margins.top)} / ${cm(profile.margins.bottom)}`,
        count: wrongSections.length + Number(impliedSection),
        fixable: true,
        severity: "warning",
      },
      sections: wrongSections,
      impliedSection,
    });
  }
  const addManual = (
    id: string,
    category: Issue["category"],
    title: string,
    description: string,
    count: number,
    found: string,
    expected: string,
  ) => {
    if (!count) return;
    matches.push({
      issue: {
        id,
        ruleId: id,
        category,
        title,
        description,
        found,
        expected,
        count,
        fixable: false,
        severity: "info",
      },
    });
  };
  addManual(
    "headings.structure",
    "headings",
    "Проверьте структуру заголовков",
    "Некоторые строки похожи на заголовки или элементы титульного листа, но не имеют соответствующего стиля. Проверьте их вручную: автоматические правки к ним не применяются.",
    suspiciousHeadings.length,
    "Вероятные заголовки без явно заданного стиля",
    "Проверьте уровни и стили заголовков в редакторе",
  );
  addManual(
    "paragraph.indent.manual",
    "paragraphs",
    "Сложный отступ из стиля",
    "Отступ задан в символах или как выступ в стиле документа. Его изменение требует правки стиля; для сохранности оформления выполните её вручную.",
    complexIndents.length,
    "Унаследованный отступ в символах или выступ",
    cm(profile.firstLineIndent),
  );
  addManual(
    "page.margins.manual",
    "page",
    "Поля не помещаются на странице",
    "Сумма выбранных полей и переплётного отступа превышает размер страницы этого раздела. Уменьшите поля или проверьте размер бумаги вручную.",
    conflictingSections.length,
    "Недостаточно места для области текста",
    "Поля должны оставлять положительную ширину и высоту текста",
  );
  const bodyChildren: XmlElement[] = [];
  for (let node = parsed.body.firstChild; node; node = node.nextSibling)
    if (node.nodeType === 1) bodyChildren.push(node as XmlElement);
  let tablesWithoutCaption = 0,
    imagesWithoutCaption = 0;
  for (let i = 0; i < bodyChildren.length; i++) {
    const el = bodyChildren[i];
    const nearby = [bodyChildren[i - 1], bodyChildren[i + 1]]
      .filter(Boolean)
      .map((p) => paragraphText(p).trim());
    if (
      el.localName === "tbl" &&
      !nearby.some((text) => /^(таблица|табл\.|table)\s*[\dIVX]/iu.test(text))
    )
      tablesWithoutCaption++;
    if (descendants(el, "drawing").length || descendants(el, "pict").length) {
      if (
        !nearby
          .concat(paragraphText(el))
          .some((text) => /^(рис(унок|\.)?|figure)\s*[\dIVX]/iu.test(text))
      )
        imagesWithoutCaption++;
    }
  }
  addManual(
    "tables.caption",
    "tables",
    "Проверьте подписи таблиц",
    "Рядом с таблицей не найдена текстовая подпись. Она может находиться в другом месте; сервис не добавляет вымышленные названия.",
    tablesWithoutCaption,
    "Не найдена подпись рядом с таблицей",
    "Проверьте название и номер таблицы",
  );
  addManual(
    "images.caption",
    "images",
    "Проверьте подписи иллюстраций",
    "Рядом с иллюстрацией не найдена подпись. Изображения и их расположение остаются без изменений.",
    imagesWithoutCaption,
    "Не найдена подпись рядом с иллюстрацией",
    "Проверьте название и номер рисунка",
  );
  if (protectedCount)
    warnings.push(
      `Защищённые от автоматических правок фрагменты: ${protectedCount}. Заголовки, подписи, списки, формулы, поля и рецензирование требуют отдельной проверки.`,
    );
  if (!eligible.length)
    warnings.unshift(
      "Обычный основной текст для автоматической проверки не найден. Оценка относится только к полям страницы и не подтверждает готовность всей работы.",
    );
  warnings.push(
    "Оценка учитывает проверяемые параметры основного текста и полей. Содержимое таблиц, сноски, нумерация страниц и библиография автоматически не исправляются.",
  );
  const totalChecks =
    eligible.length * 5 +
    Math.max(safeSections.length, sections.length === 0 ? 1 : 0);
  const failures = matches
    .filter((m) => m.issue.fixable)
    .reduce((n, m) => n + m.issue.count, 0);
  const texts = allParagraphs.map(paragraphText);
  const words =
    texts.join(" ").match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu)?.length ??
    0;
  const imageCount =
    descendants(parsed.body, "drawing").length +
    descendants(parsed.body, "pict").length;
  return {
    report: {
      score: totalChecks
        ? Math.max(0, Math.round((1 - failures / totalChecks) * 100))
        : 100,
      issues: matches.map((m) => m.issue),
      stats: {
        paragraphs: allParagraphs.length,
        words,
        tables: descendants(parsed.body, "tbl").length,
        images: imageCount,
        sections: Math.max(1, sections.length),
      },
      excerpt: texts.filter(Boolean).join("\n").slice(0, 1400),
      checkedRules: 6,
      warnings,
    },
    matches,
  };
}
