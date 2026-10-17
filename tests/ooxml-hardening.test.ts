import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, Zip, ZipPassThrough } from "fflate";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { analyzeDocument, fixDocument } from "../src/document/engine";
import { DEFAULT_PROFILE } from "../src/document/profile";
import { parseDocument } from "../src/document/parser";
import { createFixture, documentXml, fixtureEntries, W_NS } from "./fixtures";

const section =
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:left="1701" w:right="850" w:top="1134" w:bottom="1134" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
const body =
  "<w:p><w:r><w:t>Обычный текст, который можно безопасно исправить.</w:t></w:r></w:p>";
const paragraph = (text: string, properties = "", runProperties = "") =>
  `<w:p><w:pPr>${properties}</w:pPr><w:r><w:rPr>${runProperties}</w:rPr><w:t>${text}</w:t></w:r></w:p>`;
const fixture = (content: string, styles?: string) =>
  createFixture({
    document: documentXml({ rich: false }).replace(
      /<w:body>[\s\S]*<\/w:body>/,
      `<w:body>${content}</w:body>`,
    ),
    styles,
  });
const fixAll = (bytes: Uint8Array) =>
  fixDocument(
    bytes,
    DEFAULT_PROFILE,
    analyzeDocument(bytes, DEFAULT_PROFILE)
      .issues.filter((i) => i.fixable)
      .map((i) => i.id),
  );
const paragraphs = (bytes: Uint8Array) => {
  const xml = new DOMParser().parseFromString(
    strFromU8(unzipSync(bytes)["word/document.xml"]),
    "application/xml",
  );
  return Array.from(xml.getElementsByTagNameNS(W_NS, "p")).map((p) =>
    new XMLSerializer().serializeToString(p),
  );
};

describe("adversarial OOXML classification", () => {
  it("preserves legal unknown ZIP parts named like Object prototype properties", () => {
    const entries = Object.assign(
      Object.create(null),
      fixtureEntries({ rich: false }),
    ) as Record<string, Uint8Array>;
    const names = ["__proto__", "constructor", "toString"];
    for (const name of names) entries[name] = strToU8(`opaque payload ${name}`);
    entries["[Content_Types].xml"] = strToU8(
      strFromU8(entries["[Content_Types].xml"]).replace(
        "</Types>",
        names
          .map(
            (name) =>
              `<Override PartName="/${name}" ContentType="application/octet-stream"/>`,
          )
          .join("") + "</Types>",
      ),
    );
    // The independent streaming writer supports prototype-like filenames;
    // fflate's object-flattening zipSync implementation cannot create these.
    const chunks: Uint8Array[] = [];
    const archive = new Zip((error, data) => {
      if (error) throw error;
      chunks.push(data);
    });
    for (const [name, bytes] of Object.entries(entries)) {
      const part = new ZipPassThrough(name);
      archive.add(part);
      part.push(bytes, true);
    }
    archive.end();
    const original = new Uint8Array(
      chunks.reduce((total, chunk) => total + chunk.length, 0),
    );
    let offset = 0;
    for (const chunk of chunks) {
      original.set(chunk, offset);
      offset += chunk.length;
    }
    const result = fixAll(original);
    expect(result.fixedCount).toBeGreaterThan(0);
    const reopened = parseDocument(result.bytes);
    for (const name of names) {
      expect(Object.hasOwn(reopened.entries, name)).toBe(true);
      expect(reopened.entries[name]).toEqual(entries[name]);
    }
  });

  it.each([
    "Список использованных источников",
    "Список использованной литературы",
    "Библиографический список",
    "Литература",
    "Библиография",
    "References",
    "Список литературы:",
  ])("protects bibliography entries after %s", (heading) => {
    const original = fixture(
      body +
        paragraph(heading) +
        paragraph("Иванов И. И. Исследования. Москва: Наука, 2024.") +
        section,
    );
    const fixed = fixAll(original);
    expect(paragraphs(fixed.bytes).slice(1)).toEqual(
      paragraphs(original).slice(1),
    );
    expect(
      fixed.report.issues.some(
        (i) => i.ruleId === "references.manual" && !i.fixable,
      ),
    ).toBe(true);
    expect(fixed.report.coverage?.checkedParagraphs).toBe(1);
  });

  it.each(["Caption", "Title", "Bibliography"])(
    "protects styles derived from %s even without inherited outline",
    (ancestor) => {
      const styles = `<w:styles xmlns:w="${W_NS}"><w:style w:type="paragraph" w:styleId="${ancestor}"><w:name w:val="${ancestor}"/></w:style><w:style w:type="paragraph" w:styleId="Custom"><w:basedOn w:val="${ancestor}"/><w:name w:val="Custom"/></w:style></w:styles>`;
      const original = fixture(
        paragraph("Особый фрагмент.", '<w:pStyle w:val="Custom"/>') +
          body +
          section,
        styles,
      );
      expect(paragraphs(fixAll(original).bytes)[0]).toBe(
        paragraphs(original)[0],
      );
    },
  );

  it.each(["center", "right"])(
    "protects short %s title-page lines even with punctuation",
    (alignment) => {
      const original = fixture(
        paragraph("Выполнил: Иванов И. И.", `<w:jc w:val="${alignment}"/>`) +
          body +
          section,
      );
      expect(paragraphs(fixAll(original).bytes)[0]).toBe(
        paragraphs(original)[0],
      );
    },
  );

  it.each([
    "МИНИСТЕРСТВО НАУКИ И ВЫСШЕГО ОБРАЗОВАНИЯ",
    "Санкт-Петербургский государственный университет",
    "Курсовая работа",
  ])(
    "preserves a leading title-page block beginning with %s and ending in a page break",
    (marker) => {
      const title =
        paragraph(marker) +
        paragraph("Факультет технических наук.") +
        paragraph("Исследование современных технологий.") +
        '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      const original = fixture(title + body + section);
      const fixed = fixAll(original);
      expect(paragraphs(fixed.bytes).slice(0, 4)).toEqual(
        paragraphs(original).slice(0, 4),
      );
      expect(fixed.report.coverage?.checkedParagraphs).toBe(1);
    },
  );

  it("protects special vertical alignment inherited from character styles", () => {
    const styles = `<w:styles xmlns:w="${W_NS}"><w:style w:type="character" w:styleId="Small"><w:rPr><w:vertAlign w:val="superscript"/><w:sz w:val="18"/></w:rPr></w:style></w:styles>`;
    const original = fixture(
      paragraph("Индекс", "", '<w:rStyle w:val="Small"/>') + body + section,
      styles,
    );
    expect(paragraphs(fixAll(original).bytes)[0]).toBe(paragraphs(original)[0]);
  });

  it("does not guess formatting for an unresolved or cyclic style chain", () => {
    const styles = `<w:styles xmlns:w="${W_NS}"><w:style w:type="paragraph" w:styleId="A"><w:basedOn w:val="B"/></w:style><w:style w:type="paragraph" w:styleId="B"><w:basedOn w:val="A"/></w:style></w:styles>`;
    const original = fixture(
      paragraph("Неизвестное наследование.", '<w:pStyle w:val="A"/>') +
        body +
        section,
      styles,
    );
    expect(paragraphs(fixAll(original).bytes)[0]).toBe(paragraphs(original)[0]);
    expect(
      analyzeDocument(original, DEFAULT_PROFILE).issues.some(
        (i) =>
          i.ruleId === "text.special.manual" &&
          /наследован|стил/i.test(i.description),
      ),
    ).toBe(true);
  });

  it("does not normalize CJK font slots that are outside the supported font model", () => {
    const original = fixture(
      paragraph("Русский текст и 中文混排.") + body + section,
    );
    expect(paragraphs(fixAll(original).bytes)[0]).toBe(paragraphs(original)[0]);
  });
});

describe("honest check coverage", () => {
  it.each([
    ["center", 1.25],
    ["right", 1.25],
    ["center", 0],
    ["right", 0],
  ] as const)(
    "keeps coverage and output idempotent for custom %s alignment and %s cm indent",
    (alignment, firstLineIndent) => {
      const profile = { ...DEFAULT_PROFILE, alignment, firstLineIndent };
      const original = fixture(body + section);
      const before = analyzeDocument(original, profile);
      const first = fixDocument(
        original,
        profile,
        before.issues.filter((i) => i.fixable).map((i) => i.id),
      );
      expect(first.report.coverage?.checkedParagraphs).toBe(
        before.coverage?.checkedParagraphs,
      );
      const second = fixDocument(
        first.bytes,
        profile,
        first.report.issues.filter((i) => i.fixable).map((i) => i.id),
      );
      expect(second.fixedCount).toBe(0);
      expect(second.bytes).toEqual(first.bytes);
      expect(second.report).toEqual(first.report);
    },
  );

  it("does not claim line-spacing compliance where an active document grid controls the baseline", () => {
    const gridSection = section.replace(
      "</w:sectPr>",
      '<w:docGrid w:type="lines" w:linePitch="400"/></w:sectPr>',
    );
    const original = fixture(body + gridSection);
    const report = analyzeDocument(original, DEFAULT_PROFILE);
    expect(
      report.issues.some((i) => i.ruleId === "paragraph.spacing" && i.fixable),
    ).toBe(false);
    expect(
      report.issues.some(
        (i) => i.ruleId === "paragraph.grid.manual" && !i.fixable,
      ),
    ).toBe(true);
    expect(report.coverage?.checkedChecks).toBe(5);
    const fixed = fixAll(original);
    expect(
      strFromU8(unzipSync(fixed.bytes)["word/document.xml"]),
    ).not.toContain('w:line="360"');
  });

  it("checks line spacing when a paragraph explicitly disables grid snapping", () => {
    const gridSection = section.replace(
      "</w:sectPr>",
      '<w:docGrid w:type="lines" w:linePitch="400"/></w:sectPr>',
    );
    const original = fixture(
      paragraph("Обычный абзац.", '<w:snapToGrid w:val="0"/>') + gridSection,
    );
    const report = analyzeDocument(original, DEFAULT_PROFILE);
    expect(
      report.issues.some((i) => i.ruleId === "paragraph.spacing" && i.fixable),
    ).toBe(true);
    expect(report.coverage?.checkedChecks).toBe(6);
  });

  it("returns zero checked parameters when all sections have tracked properties", () => {
    const unsafeSection = section.replace(
      "</w:sectPr>",
      '<w:sectPrChange w:id="1" w:author="Editor"><w:sectPr><w:pgMar w:left="720"/></w:sectPr></w:sectPrChange></w:sectPr>',
    );
    const report = analyzeDocument(fixture(unsafeSection), DEFAULT_PROFILE);
    expect(report.score).toBe(0);
    expect(report.checkedRules).toBe(0);
    expect(report.coverage?.checkedChecks).toBe(0);
    expect(
      report.issues.some(
        (i) => i.ruleId === "page.revisions.manual" && !i.fixable,
      ),
    ).toBe(true);
  });

  it("does not count manual inherited indentation as a passed automatic check", () => {
    const styles = `<w:styles xmlns:w="${W_NS}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:pPr><w:ind w:hanging="360"/></w:pPr></w:style></w:styles>`;
    const report = analyzeDocument(
      fixture(body + section, styles),
      DEFAULT_PROFILE,
    );
    expect(report.coverage?.checkedChecks).toBe(5);
    expect(report.coverage?.totalChecks).toBe(6);
    expect(
      report.issues.some((i) => i.ruleId === "paragraph.indent.manual"),
    ).toBe(true);
  });
});
