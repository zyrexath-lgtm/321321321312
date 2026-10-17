import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { analyzeDocument, fixDocument } from "../src/document/engine";
import { DEFAULT_PROFILE, validateProfile } from "../src/document/profile";
import {
  badParagraph,
  createFixture,
  documentXml,
  fixtureEntries,
  W_NS,
} from "./fixtures";

const FONT = "text.font";
const SIZE = "text.size";
const MARGINS = "page.margins";
const formattingRules = [
  FONT,
  SIZE,
  "paragraph.spacing",
  "paragraph.indent",
  "paragraph.alignment",
  MARGINS,
];

function xmlOf(bytes: Uint8Array) {
  const xml = strFromU8(unzipSync(bytes)["word/document.xml"]);
  return new DOMParser({
    onError: (level, message) => {
      if (level === "fatalError") throw new Error(message);
    },
  }).parseFromString(xml, "application/xml");
}

function textOf(bytes: Uint8Array) {
  return Array.from(xmlOf(bytes).getElementsByTagNameNS(W_NS, "t")).map(
    (node) => node.textContent,
  );
}

function snapshots(bytes: Uint8Array, localName: string, ns = W_NS) {
  const serializer = new XMLSerializer();
  return Array.from(xmlOf(bytes).getElementsByTagNameNS(ns, localName)).map(
    (node) => serializer.serializeToString(node),
  );
}

function fixAll(bytes: Uint8Array, profile = DEFAULT_PROFILE) {
  const report = analyzeDocument(bytes, profile);
  return fixDocument(
    bytes,
    profile,
    report.issues.filter((issue) => issue.fixable).map((issue) => issue.id),
  );
}

function documentWithBody(body: string) {
  return documentXml({ rich: false }).replace(
    /<w:body>[\s\S]*<\/w:body>/,
    `<w:body>${body}</w:body>`,
  );
}

const correctSection =
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:left="1701" w:right="850" w:top="1134" w:bottom="1134" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';

describe("DOCX formatting analysis", () => {
  it("detects six actual formatting violations from direct and inherited properties", () => {
    const report = analyzeDocument(
      createFixture({ rich: false }),
      DEFAULT_PROFILE,
    );
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThan(100);
    expect(report.issues.map((issue) => issue.ruleId)).toEqual(
      expect.arrayContaining(formattingRules),
    );
    for (const id of formattingRules) {
      const issue = report.issues.find((item) => item.ruleId === id)!;
      expect(issue.fixable).toBe(true);
      expect(issue.count).toBeGreaterThan(0);
      expect(issue.description.length).toBeGreaterThan(10);
      expect(issue.found).not.toBe(issue.expected);
    }
  });

  it("resolves formatting through paragraph basedOn styles and document defaults", () => {
    const entries = fixtureEntries({ rich: false });
    const xml = strFromU8(entries["word/document.xml"]);
    // Remove the explicit paragraph, so the only text is formatted by BodyText → Normal.
    entries["word/document.xml"] = strToU8(
      xml.replace(/<w:p w:rsidR="00112233">[\s\S]*?<\/w:p>/, ""),
    );
    const report = analyzeDocument(zipSync(entries), DEFAULT_PROFILE);
    expect(report.issues.map((issue) => issue.ruleId)).toEqual(
      expect.arrayContaining([FONT, SIZE, "paragraph.spacing"]),
    );
    const fixed = fixAll(zipSync(entries));
    expect(
      analyzeDocument(fixed.bytes, DEFAULT_PROFILE).issues.filter(
        (issue) => issue.fixable,
      ),
    ).toHaveLength(0);
  });

  it("does not treat headings, table cells, and numbered text as ordinary body paragraphs", () => {
    const before = createFixture();
    const result = fixAll(before);
    expect(snapshots(result.bytes, "tbl")).toEqual(snapshots(before, "tbl"));
    const original = xmlOf(before);
    const transformed = xmlOf(result.bytes);
    const findProtectedParagraphs = (doc: typeof original) =>
      Array.from(doc.getElementsByTagNameNS(W_NS, "p"))
        .filter((p) => {
          const style = p.getElementsByTagNameNS(W_NS, "pStyle")[0];
          return (
            style?.getAttributeNS(W_NS, "val") === "Heading1" ||
            p.getElementsByTagNameNS(W_NS, "numPr").length > 0
          );
        })
        .map((p) => new XMLSerializer().serializeToString(p));
    expect(findProtectedParagraphs(transformed)).toEqual(
      findProtectedParagraphs(original),
    );
  });

  it("distinguishes exact line height from the requested 1.5 line multiplier", () => {
    const document = documentXml({ rich: false }).replace(
      'w:line="240" w:lineRule="auto"',
      'w:line="360" w:lineRule="exact"',
    );
    const original = createFixture({ rich: false, document });
    const spacing = analyzeDocument(original, DEFAULT_PROFILE).issues.find(
      (issue) => issue.ruleId === "paragraph.spacing",
    );
    expect(spacing?.fixable).toBe(true);
    const fixed = fixDocument(original, DEFAULT_PROFILE, [spacing!.id]);
    const firstSpacing = xmlOf(fixed.bytes).getElementsByTagNameNS(
      W_NS,
      "spacing",
    )[0];
    expect(firstSpacing.getAttributeNS(W_NS, "line")).toBe("360");
    expect(firstSpacing.getAttributeNS(W_NS, "lineRule")).toBe("auto");
  });

  it("detects an incorrect ASCII font even when the high-ANSI font matches the profile", () => {
    const paragraph =
      '<w:p><w:pPr><w:spacing w:line="360" w:lineRule="auto"/><w:ind w:firstLine="709"/><w:jc w:val="both"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Times New Roman"/><w:sz w:val="28"/></w:rPr><w:t>English text and русский текст в одном абзаце.</w:t></w:r></w:p>';
    const original = createFixture({
      document: documentWithBody(paragraph + correctSection),
    });
    const issue = analyzeDocument(original, DEFAULT_PROFILE).issues.find(
      (item) => item.ruleId === FONT,
    );
    expect(issue?.fixable).toBe(true);
    expect(issue?.found).toContain("Arial");
    const fixed = fixDocument(original, DEFAULT_PROFILE, [issue!.id]);
    expect(
      analyzeDocument(fixed.bytes, DEFAULT_PROFILE).issues.some(
        (item) => item.ruleId === FONT,
      ),
    ).toBe(false);
    const fonts = xmlOf(fixed.bytes).getElementsByTagNameNS(W_NS, "rFonts")[0];
    expect(fonts.getAttributeNS(W_NS, "ascii")).toBe("Times New Roman");
    expect(fonts.getAttributeNS(W_NS, "hAnsi")).toBe("Times New Roman");
    expect(textOf(fixed.bytes)).toEqual(textOf(original));
  });

  it.each([
    [
      "only a table",
      '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Текст в таблице</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
    ],
    [
      "only a heading",
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Заголовок без основного текста</w:t></w:r></w:p>',
    ],
    ["no paragraphs", ""],
  ])("clearly limits the score when there is %s", (_label, body) => {
    const report = analyzeDocument(
      createFixture({ document: documentWithBody(body + correctSection) }),
      DEFAULT_PROFILE,
    );
    expect(report.issues.filter((issue) => issue.fixable)).toHaveLength(0);
    expect(
      report.warnings.some((warning) =>
        /основной текст.*не найден/i.test(warning),
      ),
    ).toBe(true);
    expect(
      report.warnings.some((warning) =>
        /оценка.*только.*полям.*не подтверждает/i.test(warning),
      ),
    ).toBe(true);
  });
});

describe("safe document transformation", () => {
  it.each([
    ["Введение", "left"],
    ["Заключение", "left"],
    ["Содержание", "left"],
    ["Приложение А", "left"],
    ["ВВЕДЕНИЕ:", "left"],
    ["Заключение.", "left"],
    ["Курсовая работа", "center"],
    ["Министерство науки и высшего образования", "center"],
  ])(
    "preserves an unstyled title '%s' and requests manual heading review",
    (title, alignment) => {
      const titleParagraph = badParagraph
        .replace("<w:pPr>", '<w:pPr><w:pStyle w:val="Normal"/>')
        .replace('w:val="left"', `w:val="${alignment}"`)
        .replace(/<w:t[^>]*>[\s\S]*?<\/w:t>/, `<w:t>${title}</w:t>`);
      // The second paragraph is ordinary BodyText with a full sentence. It must
      // still receive real formatting repairs while the title stays untouched.
      const original = createFixture({
        rich: false,
        document: documentXml({ rich: false }).replace(
          badParagraph,
          titleParagraph,
        ),
      });
      const report = analyzeDocument(original, DEFAULT_PROFILE);
      const heading = report.issues.find(
        (issue) => issue.ruleId === "headings.structure",
      );
      expect(heading?.fixable).toBe(false);
      expect(heading?.count).toBe(1);
      expect(
        report.issues.some(
          (issue) => issue.fixable && issue.category === "paragraphs",
        ),
      ).toBe(true);
      const fixed = fixAll(original);
      expect(fixed.fixedCount).toBeGreaterThan(0);
      const marked = (bytes: Uint8Array) =>
        Array.from(xmlOf(bytes).getElementsByTagNameNS(W_NS, "p"))
          .filter((p) => p.getAttributeNS(W_NS, "rsidR") === "00112233")
          .map((p) => new XMLSerializer().serializeToString(p));
      expect(marked(original)).toHaveLength(1);
      expect(marked(fixed.bytes)).toEqual(marked(original));
      expect(textOf(fixed.bytes)).toEqual(textOf(original));
      expect(fixed.report.issues.filter((issue) => issue.fixable)).toHaveLength(
        0,
      );
      expect(
        fixed.report.issues.find(
          (issue) => issue.ruleId === "headings.structure",
        )?.fixable,
      ).toBe(false);
    },
  );

  it("exports original and corrected rich fixtures for independent Office validation", () => {
    const original = createFixture();
    const fixed = fixAll(original);
    mkdirSync("/tmp/norma-validation", { recursive: true });
    writeFileSync("/tmp/norma-validation/original.docx", original);
    writeFileSync("/tmp/norma-validation/fixed.docx", fixed.bytes);
    expect(fixed.bytes.byteLength).toBeGreaterThan(0);
  });

  it("fixes selected violations, improves score, and produces a reparsable document", () => {
    const original = createFixture({ rich: false });
    const before = analyzeDocument(original, DEFAULT_PROFILE);
    const fixed = fixAll(original);
    const after = analyzeDocument(fixed.bytes, DEFAULT_PROFILE);
    expect(fixed.fixedCount).toBeGreaterThan(0);
    expect(after.score).toBeGreaterThan(before.score);
    expect(after.issues.filter((issue) => issue.fixable)).toHaveLength(0);
    expect(xmlOf(fixed.bytes).documentElement?.localName).toBe("document");
    expect(xmlOf(fixed.bytes).documentElement?.namespaceURI).toBe(W_NS);
    expect(fixed.report.issues).toEqual(after.issues);
  });

  it("keeps every text node, whitespace, order, and the original input bytes", () => {
    const original = createFixture();
    const originalCopy = original.slice();
    const fixed = fixAll(original);
    expect(textOf(fixed.bytes)).toEqual(textOf(original));
    expect(textOf(fixed.bytes)).toContain(
      "Учебная работа: проверяем текст,  формулы и оформление. ",
    );
    expect(original).toEqual(originalCopy);
  });

  it("preserves every other package part byte-for-byte, including images and relationships", () => {
    const original = createFixture();
    const fixed = fixAll(original);
    const beforeParts = unzipSync(original);
    const afterParts = unzipSync(fixed.bytes);
    expect(Object.keys(afterParts).sort()).toEqual(
      Object.keys(beforeParts).sort(),
    );
    for (const [path, content] of Object.entries(beforeParts)) {
      if (path !== "word/document.xml")
        expect(afterParts[path], path).toEqual(content);
    }
    expect(afterParts["word/media/image1.png"].slice(0, 8)).toEqual(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(afterParts["word/document.xml"]).not.toEqual(
      beforeParts["word/document.xml"],
    );
  });

  it("preserves nested tables, drawings, equations, list definitions, and footnotes", () => {
    const original = createFixture();
    const fixed = fixAll(original);
    for (const node of [
      "tbl",
      "drawing",
      "numPr",
      "footnoteReference",
      "bookmarkStart",
      "bookmarkEnd",
    ]) {
      expect(snapshots(fixed.bytes, node), node).toEqual(
        snapshots(original, node),
      );
    }
    const mathNs = "http://schemas.openxmlformats.org/officeDocument/2006/math";
    expect(snapshots(fixed.bytes, "oMath", mathNs)).toEqual(
      snapshots(original, "oMath", mathNs),
    );
    expect(snapshots(fixed.bytes, "tbl")).toHaveLength(2);
    expect(snapshots(fixed.bytes, "drawing")).toHaveLength(1);
  });

  it("preserves section breaks, page sizes, headers, footers, and hyperlink targets", () => {
    const original = createFixture();
    const fixed = fixAll(original);
    for (const node of ["type", "pgSz", "headerReference", "footerReference"]) {
      expect(snapshots(fixed.bytes, node), node).toEqual(
        snapshots(original, node),
      );
    }
    expect(snapshots(fixed.bytes, "sectPr")).toHaveLength(2);
    const hyperlink = xmlOf(fixed.bytes).getElementsByTagNameNS(
      W_NS,
      "hyperlink",
    )[0];
    expect(
      hyperlink.getAttributeNS(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "id",
      ),
    ).toBe("rIdHyperlink");
    expect(hyperlink.textContent).toBe("источник");
  });

  it.each(["missing section", "missing page margins"])(
    "writes every required PageMar attribute for %s",
    (condition) => {
      const document =
        condition === "missing section"
          ? documentXml({ rich: false }).replace(
              /<w:sectPr>[\s\S]*?<\/w:sectPr>/g,
              "",
            )
          : documentXml({ rich: false }).replace(/<w:pgMar\b[^>]*\/>/g, "");
      const original = createFixture({ rich: false, document });
      const pageIssue = analyzeDocument(original, DEFAULT_PROFILE).issues.find(
        (issue) => issue.ruleId === MARGINS,
      );
      expect(pageIssue?.fixable).toBe(true);
      const fixed = fixDocument(original, DEFAULT_PROFILE, [pageIssue!.id]);
      const margins = xmlOf(fixed.bytes).getElementsByTagNameNS(W_NS, "pgMar");
      expect(margins.length).toBe(1);
      for (const name of [
        "left",
        "right",
        "top",
        "bottom",
        "header",
        "footer",
        "gutter",
      ]) {
        expect(margins[0].hasAttributeNS(W_NS, name), name).toBe(true);
        expect(margins[0].getAttributeNS(W_NS, name), name).toMatch(/^\d+$/);
      }
      expect(margins[0].getAttributeNS(W_NS, "left")).toBe("1701");
      expect(margins[0].getAttributeNS(W_NS, "right")).toBe("850");
      expect(margins[0].getAttributeNS(W_NS, "top")).toBe("1134");
      expect(margins[0].getAttributeNS(W_NS, "bottom")).toBe("1134");
      expect(margins[0].getAttributeNS(W_NS, "header")).toBe("720");
      expect(margins[0].getAttributeNS(W_NS, "footer")).toBe("720");
      expect(margins[0].getAttributeNS(W_NS, "gutter")).toBe("0");
      for (const node of ["pgSz", "headerReference", "footerReference"]) {
        expect(snapshots(fixed.bytes, node), node).toEqual(
          snapshots(original, node),
        );
      }
      expect(textOf(fixed.bytes)).toEqual(textOf(original));
      expect(
        analyzeDocument(fixed.bytes, DEFAULT_PROFILE).issues.some(
          (issue) => issue.ruleId === MARGINS,
        ),
      ).toBe(false);
    },
  );

  it("preserves existing header distance and gutter while defaulting only absent PageMar attributes", () => {
    const document = documentXml({ rich: false }).replace(
      /<w:pgMar\b[^>]*\/>/,
      '<w:pgMar w:left="720" w:right="720" w:top="720" w:bottom="720" w:header="900" w:gutter="240"/>',
    );
    const original = createFixture({ rich: false, document });
    const issue = analyzeDocument(original, DEFAULT_PROFILE).issues.find(
      (item) => item.ruleId === MARGINS,
    )!;
    const fixed = fixDocument(original, DEFAULT_PROFILE, [issue.id]);
    const margins = xmlOf(fixed.bytes).getElementsByTagNameNS(W_NS, "pgMar")[0];
    expect(margins.getAttributeNS(W_NS, "header")).toBe("900");
    expect(margins.getAttributeNS(W_NS, "gutter")).toBe("240");
    expect(margins.getAttributeNS(W_NS, "footer")).toBe("720");
    expect(snapshots(fixed.bytes, "pgSz")).toEqual(snapshots(original, "pgSz"));
    expect(snapshots(fixed.bytes, "headerReference")).toEqual(
      snapshots(original, "headerReference"),
    );
  });

  it.each(["page too narrow", "gutter leaves no text area"])(
    "marks conflicting margins as manual when %s",
    (condition) => {
      const profile =
        condition === "page too narrow"
          ? {
              ...DEFAULT_PROFILE,
              margins: { ...DEFAULT_PROFILE.margins, left: 5, right: 5 },
            }
          : DEFAULT_PROFILE;
      const document =
        condition === "page too narrow"
          ? documentXml({ rich: false }).replace('w:w="11906"', 'w:w="5000"')
          : documentXml({ rich: false }).replace(
              'w:gutter="0"',
              'w:gutter="10000"',
            );
      const original = createFixture({ rich: false, document });
      const report = analyzeDocument(original, profile);
      const manual = report.issues.find(
        (issue) => issue.ruleId === "page.margins.manual",
      );
      expect(manual?.fixable).toBe(false);
      expect(
        report.issues.some(
          (issue) => issue.ruleId === MARGINS && issue.fixable,
        ),
      ).toBe(false);
      const fixed = fixAll(original, profile);
      expect(snapshots(fixed.bytes, "sectPr")).toEqual(
        snapshots(original, "sectPr"),
      );
      expect(textOf(fixed.bytes)).toEqual(textOf(original));
    },
  );

  it("keeps field-code and tracked-change paragraphs intact during body fixes", () => {
    const protectedParagraphs = `<w:p w:rsidR="00000001"><w:pPr><w:spacing w:line="240"/><w:jc w:val="left"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="24"/></w:rPr><w:t>Содержание с полем Word</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p><w:p w:rsidR="00000002"><w:pPr><w:spacing w:line="240"/></w:pPr><w:ins w:id="7" w:author="Автор" w:date="2026-01-01T00:00:00Z"><w:r><w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="24"/></w:rPr><w:t>Вставленный текст</w:t></w:r></w:ins><w:del w:id="8" w:author="Автор" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>Удалённый текст</w:delText></w:r></w:del></w:p>`;
    const original = createFixture({
      rich: false,
      document: documentXml({ rich: false }).replace(
        badParagraph,
        protectedParagraphs,
      ),
    });
    const fixed = fixAll(original);
    const extract = (bytes: Uint8Array) =>
      Array.from(xmlOf(bytes).getElementsByTagNameNS(W_NS, "p"))
        .filter((p) =>
          ["00000001", "00000002"].includes(
            p.getAttributeNS(W_NS, "rsidR") ?? "",
          ),
        )
        .map((p) => new XMLSerializer().serializeToString(p));
    expect(extract(original)).toHaveLength(2);
    expect(extract(fixed.bytes)).toEqual(extract(original));
    expect(textOf(fixed.bytes)).toEqual(textOf(original));
  });

  it.each([
    "direct bidi",
    "inherited bidi",
    "run rtl",
    "run cs",
    "Arabic",
    "Hebrew",
  ])("preserves unsupported %s paragraphs completely", (kind) => {
    let paragraph = badParagraph;
    const entries = fixtureEntries({ rich: false });
    let styles = strFromU8(entries["word/styles.xml"]);
    if (kind === "direct bidi")
      paragraph = paragraph.replace("<w:pPr>", "<w:pPr><w:bidi/>");
    if (kind === "inherited bidi") {
      paragraph = paragraph.replace(
        "<w:pPr>",
        '<w:pPr><w:pStyle w:val="BidiBody"/>',
      );
      styles = styles.replace(
        "</w:styles>",
        '<w:style w:type="paragraph" w:styleId="BidiBody"><w:name w:val="Bidi Body"/><w:basedOn w:val="Normal"/><w:pPr><w:bidi/></w:pPr></w:style></w:styles>',
      );
    }
    if (kind === "run rtl")
      paragraph = paragraph.replace("<w:rPr>", "<w:rPr><w:rtl/>");
    if (kind === "run cs")
      paragraph = paragraph.replace("<w:rPr>", "<w:rPr><w:cs/>");
    if (kind === "Arabic")
      paragraph = paragraph.replace(
        /<w:t[^>]*>[\s\S]*?<\/w:t>/,
        "<w:t>هذا نص عربي يجب الحفاظ عليه</w:t>",
      );
    if (kind === "Hebrew")
      paragraph = paragraph.replace(
        /<w:t[^>]*>[\s\S]*?<\/w:t>/,
        "<w:t>טקסט בעברית צריך להישמר</w:t>",
      );
    const original = createFixture({
      rich: false,
      document: documentXml({ rich: false }).replace(badParagraph, paragraph),
      styles,
    });
    const before = analyzeDocument(original, DEFAULT_PROFILE);
    expect(
      before.warnings.some((warning) => /защищённые.*фрагменты/i.test(warning)),
    ).toBe(true);
    const fixed = fixAll(original);
    expect(fixed.fixedCount).toBeGreaterThan(0);
    const marked = (bytes: Uint8Array) =>
      Array.from(xmlOf(bytes).getElementsByTagNameNS(W_NS, "p"))
        .filter((p) => p.getAttributeNS(W_NS, "rsidR") === "00112233")
        .map((p) => new XMLSerializer().serializeToString(p));
    expect(marked(original)).toHaveLength(1);
    expect(marked(fixed.bytes)).toEqual(marked(original));
    expect(textOf(fixed.bytes)).toEqual(textOf(original));
  });

  it("applies only the selected rule and leaves other violations available", () => {
    const original = createFixture({ rich: false });
    const before = analyzeDocument(original, DEFAULT_PROFILE);
    const fontIssue = before.issues.find((issue) => issue.ruleId === FONT)!;
    const fixed = fixDocument(original, DEFAULT_PROFILE, [fontIssue.id]);
    const after = analyzeDocument(fixed.bytes, DEFAULT_PROFILE);
    expect(after.issues.some((issue) => issue.ruleId === FONT)).toBe(false);
    expect(after.issues.map((issue) => issue.ruleId)).toEqual(
      expect.arrayContaining([SIZE, MARGINS, "paragraph.spacing"]),
    );
    expect(snapshots(fixed.bytes, "pgMar")).toEqual(
      snapshots(original, "pgMar"),
    );
    expect(textOf(fixed.bytes)).toEqual(textOf(original));
  });

  it("does nothing for an empty selection or nonexistent IDs", () => {
    const original = createFixture();
    for (const ids of [[], ["not-a-real-issue"]]) {
      const fixed = fixDocument(original, DEFAULT_PROFILE, ids);
      expect(fixed.fixedCount).toBe(0);
      expect(unzipSync(fixed.bytes)["word/document.xml"]).toEqual(
        unzipSync(original)["word/document.xml"],
      );
    }
  });

  it("supports repeat processing without accumulating formatting or changing text", () => {
    const original = createFixture();
    const first = fixAll(original);
    const second = fixAll(first.bytes);
    expect(second.fixedCount).toBe(0);
    expect(unzipSync(second.bytes)["word/document.xml"]).toEqual(
      unzipSync(first.bytes)["word/document.xml"],
    );
    expect(textOf(second.bytes)).toEqual(textOf(original));
    expect(second.report.score).toBe(first.report.score);
  });

  it("uses a custom profile rather than hardcoded default requirements", () => {
    const custom = {
      ...DEFAULT_PROFILE,
      fontFamily: "Georgia",
      fontSize: 11,
      lineSpacing: 2,
      firstLineIndent: 0.5,
      alignment: "center" as const,
      margins: { left: 2.5, right: 2, top: 2.5, bottom: 2.5 },
    };
    const fixed = fixAll(createFixture({ rich: false }), custom);
    expect(
      analyzeDocument(fixed.bytes, custom).issues.filter(
        (issue) => issue.fixable,
      ),
    ).toHaveLength(0);
    const xml = xmlOf(fixed.bytes);
    const firstRun = xml.getElementsByTagNameNS(W_NS, "r")[0];
    expect(
      firstRun
        .getElementsByTagNameNS(W_NS, "rFonts")[0]
        .getAttributeNS(W_NS, "ascii"),
    ).toBe("Georgia");
    expect(
      firstRun
        .getElementsByTagNameNS(W_NS, "sz")[0]
        .getAttributeNS(W_NS, "val"),
    ).toBe("22");
    expect(
      xml.getElementsByTagNameNS(W_NS, "jc")[0].getAttributeNS(W_NS, "val"),
    ).toBe("center");
    expect(
      analyzeDocument(fixed.bytes, DEFAULT_PROFILE).issues.filter(
        (issue) => issue.fixable,
      ).length,
    ).toBeGreaterThan(0);
  });
});

describe("invalid document handling", () => {
  it.each([
    ["empty input", new Uint8Array()],
    ["a renamed text file", strToU8("This is not a Word document")],
    [
      "a ZIP without the DOCX package",
      zipSync({ "hello.txt": strToU8("Hello") }),
    ],
    ["a truncated archive", createFixture().slice(0, 50)],
  ])("rejects %s with a useful error", (_name, bytes) => {
    expect(() =>
      analyzeDocument(bytes as Uint8Array, DEFAULT_PROFILE),
    ).toThrow();
  });

  it("rejects malformed XML rather than returning an apparently successful result", () => {
    const bytes = createFixture({ document: "<w:document><w:body><w:p" });
    expect(() => analyzeDocument(bytes, DEFAULT_PROFILE)).toThrow();
  });

  it("rejects an XML document with an unrelated root element", () => {
    const bytes = createFixture({
      document: "<html><body>Not a Word document</body></html>",
    });
    expect(() => analyzeDocument(bytes, DEFAULT_PROFILE)).toThrow();
  });

  it("rejects DTD/entity-bearing XML and does not resolve external resources", () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE document [<!ENTITY external SYSTEM "file:///etc/passwd">]><w:document xmlns:w="${W_NS}"><w:body><w:p><w:r><w:t>&external;</w:t></w:r></w:p></w:body></w:document>`;
    expect(() =>
      analyzeDocument(createFixture({ document: xml }), DEFAULT_PROFILE),
    ).toThrow();
  });

  it("rejects macro-bearing packages even when renamed to .docx", () => {
    const entries = fixtureEntries();
    entries["word/vbaProject.bin"] = new Uint8Array([0, 1, 2, 3]);
    expect(() => analyzeDocument(zipSync(entries), DEFAULT_PROFILE)).toThrow();
  });

  it("rejects macro-enabled content types even without a VBA payload", () => {
    const entries = fixtureEntries();
    entries["[Content_Types].xml"] = strToU8(
      strFromU8(entries["[Content_Types].xml"]).replace(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
        "application/vnd.ms-word.document.macroEnabled.main+xml",
      ),
    );
    expect(() => analyzeDocument(zipSync(entries), DEFAULT_PROFILE)).toThrow();
  });

  it("rejects signed packages rather than silently invalidating their signatures", () => {
    const entries = fixtureEntries();
    entries["_xmlsignatures/sig1.xml"] = strToU8(
      '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"/>',
    );
    expect(() => analyzeDocument(zipSync(entries), DEFAULT_PROFILE)).toThrow();
  });

  it("bounds XML nesting before parsing untrusted document structures", () => {
    const nested =
      "<w:sdt>".repeat(130) +
      "<w:p><w:r><w:t>Nested</w:t></w:r></w:p>" +
      "</w:sdt>".repeat(130);
    const xml = `<w:document xmlns:w="${W_NS}"><w:body>${nested}</w:body></w:document>`;
    expect(() =>
      analyzeDocument(createFixture({ document: xml }), DEFAULT_PROFILE),
    ).toThrow();
  });

  it("does not mistake a quoted /> attribute value for a self-closing XML tag", () => {
    const nested =
      '<w:x a="/>">'.repeat(150) +
      "<w:p><w:r><w:t>Nested</w:t></w:r></w:p>" +
      "</w:x>".repeat(150);
    const xml = `<w:document xmlns:w="${W_NS}"><w:body>${nested}</w:body></w:document>`;
    expect(() =>
      analyzeDocument(createFixture({ document: xml }), DEFAULT_PROFILE),
    ).toThrow();
  });

  it("rejects a dishonest ZIP checksum instead of trusting decompressed content", () => {
    const bytes = createFixture();
    const corrupted = bytes.slice();
    const view = new DataView(
      corrupted.buffer,
      corrupted.byteOffset,
      corrupted.byteLength,
    );
    let central = -1;
    for (let i = 0; i <= corrupted.length - 4; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        central = i;
        break;
      }
    }
    expect(central).toBeGreaterThan(0);
    view.setUint32(central + 16, view.getUint32(central + 16, true) ^ 1, true);
    expect(() => analyzeDocument(corrupted, DEFAULT_PROFILE)).toThrow();
  });

  it("rejects enormous ZIP size claims before allocating the advertised content", () => {
    const bytes = createFixture();
    const corrupted = bytes.slice();
    const view = new DataView(
      corrupted.buffer,
      corrupted.byteOffset,
      corrupted.byteLength,
    );
    let central = -1;
    for (let i = 0; i <= corrupted.length - 4; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        central = i;
        break;
      }
    }
    expect(central).toBeGreaterThan(0);
    view.setUint32(central + 24, 0x7fffffff, true);
    expect(() => analyzeDocument(corrupted, DEFAULT_PROFILE)).toThrow();
  });

  it("uses the validated ZIP directory when a comment contains a fake end record", () => {
    const original = createFixture();
    // A real, valid ZIP comment containing a second empty EOCD signature.
    // Its trailing byte makes that fake record invalid under ZIP comment rules.
    // This uses no large allocation and exercises parser/decompressor agreement.
    const commented = new Uint8Array(original.length + 23);
    commented.set(original);
    const view = new DataView(commented.buffer);
    view.setUint16(original.length - 2, 23, true);
    view.setUint32(original.length, 0x06054b50, true);
    commented[commented.length - 1] = 0x7f;
    const report = analyzeDocument(commented, DEFAULT_PROFILE);
    expect(report.issues).toEqual(
      analyzeDocument(original, DEFAULT_PROFILE).issues,
    );
    expect(report.stats).toEqual(
      analyzeDocument(original, DEFAULT_PROFILE).stats,
    );
  });
});

describe("profile validation", () => {
  it("accepts the supported default profile", () => {
    expect(validateProfile(DEFAULT_PROFILE)).toBe(true);
  });

  it.each([
    null,
    { ...DEFAULT_PROFILE, fontSize: Number.NaN },
    { ...DEFAULT_PROFILE, lineSpacing: 0 },
    { ...DEFAULT_PROFILE, firstLineIndent: -1 },
    { ...DEFAULT_PROFILE, fontSize: 14.25 },
    { ...DEFAULT_PROFILE, fontSize: 14.1 },
    { ...DEFAULT_PROFILE, fontFamily: "<script>" },
    { ...DEFAULT_PROFILE, margins: { ...DEFAULT_PROFILE.margins, left: 100 } },
  ])("rejects unsafe or out-of-range requirements: %j", (profile) => {
    expect(validateProfile(profile)).toBe(false);
  });

  it("accepts half-point sizes and applies them without rounding to a different requirement", () => {
    const profile = { ...DEFAULT_PROFILE, fontSize: 13.5 };
    expect(validateProfile(profile)).toBe(true);
    const original = createFixture({ rich: false });
    const fixed = fixAll(original, profile);
    expect(
      analyzeDocument(fixed.bytes, profile).issues.filter(
        (issue) => issue.fixable,
      ),
    ).toHaveLength(0);
    const firstSize = xmlOf(fixed.bytes).getElementsByTagNameNS(W_NS, "sz")[0];
    expect(firstSize.getAttributeNS(W_NS, "val")).toBe("27");
    expect(fixAll(fixed.bytes, profile).fixedCount).toBe(0);
  });
});
