import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  DOMParser,
  XMLSerializer,
  type Document,
  type Element,
} from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { analyzeDocument, fixDocument } from "../src/document/engine";
import { DEFAULT_PROFILE } from "../src/document/profile";
import {
  createAcademicFixture,
  createLongTextFixture,
  NS,
  PROTECTED_PARAGRAPHS,
} from "./corpus/academic";

const serializer = new XMLSerializer();
function parse(bytes: Uint8Array): Document {
  return new DOMParser({
    onError: (_level, message) => {
      throw new Error(message);
    },
  }).parseFromString(strFromU8(bytes), "application/xml");
}
function documentOf(bytes: Uint8Array): Document {
  return parse(unzipSync(bytes)["word/document.xml"]);
}
function serialize(node: Element | Document): string {
  return serializer.serializeToString(node);
}
function elements(doc: Document, ns: string, name: string): Element[] {
  return Array.from(doc.getElementsByTagNameNS(ns, name));
}
function allTextNodes(doc: Document): string[] {
  const result: string[] = [];
  const stack = [doc.documentElement!];
  while (stack.length) {
    const node = stack.pop()!;
    // Includes Word text, deleted text, instruction text, and MathML text.
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3 || child.nodeType === 4)
        result.push(child.nodeValue ?? "");
    }
    for (let child = node.lastChild; child; child = child.previousSibling)
      if (child.nodeType === 1) stack.push(child as Element);
  }
  return result;
}
function snapshots(doc: Document, name: string, namespace = NS.w): string[] {
  return elements(doc, namespace, name).map(serialize);
}
function protectedParagraphs(doc: Document): Record<string, string> {
  return Object.fromEntries(
    elements(doc, NS.w, "p")
      .filter((p) =>
        PROTECTED_PARAGRAPHS.includes(p.getAttributeNS(NS.w, "rsidR") || ""),
      )
      .map((p) => [p.getAttributeNS(NS.w, "rsidR"), serialize(p)]),
  );
}
function normalizedNonFormatting(doc: Document): string {
  const removable: Record<string, string[]> = {
    rFonts: ["ascii", "hAnsi", "asciiTheme", "hAnsiTheme"],
    sz: ["val"],
    spacing: ["line", "lineRule"],
    ind: ["firstLine", "firstLineChars", "hanging", "hangingChars"],
    jc: ["val"],
    pgMar: ["left", "right", "top", "bottom"],
  };
  const all = elements(doc, NS.w, "*").reverse();
  for (const el of all) {
    for (const name of removable[el.localName || ""] || [])
      el.removeAttributeNS(NS.w, name);
    if (
      [...Object.keys(removable), "rPr", "pPr"].includes(el.localName || "") &&
      !el.attributes.length &&
      !el.childNodes.length
    )
      el.parentNode!.removeChild(el);
  }
  return serialize(doc);
}

/** Independent of the application's parser: verify ZIP via fflate, parse every
 * XML part, resolve OPC targets, and verify each r:id/r:embed/r:link reference. */
function assertPackageIntegrity(bytes: Uint8Array): void {
  const entries = unzipSync(bytes);
  const xml = new Map(
    Object.entries(entries)
      .filter(([name]) => /\.(xml|rels)$/i.test(name))
      .map(([name, data]) => [name, parse(data)]),
  );
  const relationshipNs =
    "http://schemas.openxmlformats.org/package/2006/relationships";
  for (const [name, doc] of xml) {
    if (name.endsWith(".rels")) {
      const ids = new Set<string>();
      const source =
        name === "_rels/.rels"
          ? ""
          : name.replace(/(^|\/)\_rels\//, "$1").replace(/\.rels$/, "");
      for (const rel of elements(doc, relationshipNs, "Relationship")) {
        const id = rel.getAttribute("Id")!;
        expect(ids.has(id), `duplicate relationship ${name}#${id}`).toBe(false);
        ids.add(id);
        if (rel.getAttribute("TargetMode") === "External") continue;
        const target = rel.getAttribute("Target")!;
        const resolved = target.startsWith("/")
          ? target.slice(1)
          : path.posix.normalize(
              path.posix.join(path.posix.dirname(source), target),
            );
        expect(
          entries[resolved],
          `missing relationship target ${name} -> ${target}`,
        ).toBeDefined();
      }
      continue;
    }
    const relPath = path.posix.join(
      path.posix.dirname(name),
      "_rels",
      `${path.posix.basename(name)}.rels`,
    );
    const ids = new Set(
      xml.has(relPath)
        ? elements(xml.get(relPath)!, relationshipNs, "Relationship").map(
            (rel) => rel.getAttribute("Id"),
          )
        : [],
    );
    for (const el of elements(doc, "*", "*"))
      for (const attr of Array.from(el.attributes))
        if (
          attr.namespaceURI === NS.r &&
          ["id", "embed", "link"].includes(attr.localName || "")
        )
          expect(
            ids.has(attr.value),
            `dangling ${name} ${attr.name}=${attr.value}`,
          ).toBe(true);
  }
}

function fixAll(bytes: Uint8Array) {
  const report = analyzeDocument(bytes, DEFAULT_PROFILE);
  return fixDocument(
    bytes,
    DEFAULT_PROFILE,
    report.issues.filter((issue) => issue.fixable).map((issue) => issue.id),
  );
}

describe("adversarial academic DOCX corpus", () => {
  it("contains actual complex features, not disconnected sample XML", () => {
    const bytes = createAcademicFixture();
    assertPackageIntegrity(bytes);
    const doc = documentOf(bytes);
    for (const name of [
      "sectPr",
      "tbl",
      "numPr",
      "hyperlink",
      "bookmarkStart",
      "footnoteReference",
      "endnoteReference",
      "commentReference",
      "fldChar",
      "instrText",
      "fldSimple",
      "ins",
      "del",
      "moveFrom",
      "moveTo",
      "vertAlign",
    ])
      expect(elements(doc, NS.w, name).length, name).toBeGreaterThan(0);
    expect(elements(doc, NS.w, "sectPr")).toHaveLength(3);
    expect(elements(doc, NS.w, "tbl")).toHaveLength(2);
    expect(elements(doc, NS.wp, "inline")).toHaveLength(1);
    expect(elements(doc, NS.wp, "anchor")).toHaveLength(1);
    expect(elements(doc, NS.m, "oMath")).toHaveLength(1);
    expect(
      elements(doc, NS.w, "pgSz").filter(
        (el) => el.getAttributeNS(NS.w, "orient") === "landscape",
      ),
    ).toHaveLength(1);
    expect(
      new Set(
        elements(doc, NS.w, "pgMar").map((el) =>
          el.getAttributeNS(NS.w, "left"),
        ),
      ).size,
    ).toBe(3);
    const embedded = unzipSync(bytes)["word/embeddings/worksheet.xlsx"];
    expect(unzipSync(embedded)["xl/workbook.xml"]).toBeDefined();
  });

  it("roundtrips all text/Unicode, all untouched parts, XML and relationships through save/reopen", () => {
    const original = createAcademicFixture();
    const originalCopy = original.slice();
    const before = analyzeDocument(original, DEFAULT_PROFILE);
    expect(
      before.issues.filter((issue) => issue.fixable).length,
    ).toBeGreaterThan(0);
    const result = fixAll(original);
    assertPackageIntegrity(result.bytes);
    expect(original).toEqual(originalCopy);
    const beforeEntries = unzipSync(original),
      afterEntries = unzipSync(result.bytes);
    expect(Object.keys(afterEntries).sort()).toEqual(
      Object.keys(beforeEntries).sort(),
    );
    for (const [name, data] of Object.entries(beforeEntries))
      if (name !== "word/document.xml")
        expect(afterEntries[name], name).toEqual(data);
    expect(allTextNodes(documentOf(result.bytes))).toEqual(
      allTextNodes(documentOf(original)),
    );
    expect(normalizedNonFormatting(documentOf(result.bytes))).toBe(
      normalizedNonFormatting(documentOf(original)),
    );
    const reopened = analyzeDocument(result.bytes, DEFAULT_PROFILE);
    expect(reopened.issues.filter((issue) => issue.fixable)).toHaveLength(0);
    expect(reopened.score).toBeGreaterThan(before.score);
    expect(reopened.stats).toEqual(before.stats);
  });

  it("preserves title/heading/caption/list/TOC/revisions/inline-formula and bibliography paragraphs exactly", () => {
    const original = createAcademicFixture();
    expect(Object.keys(protectedParagraphs(documentOf(original)))).toHaveLength(
      PROTECTED_PARAGRAPHS.length,
    );
    expect(protectedParagraphs(documentOf(fixAll(original).bytes))).toEqual(
      protectedParagraphs(documentOf(original)),
    );
  });

  it("actually writes all five body parameters without flattening run-level emphasis", () => {
    const original = createAcademicFixture();
    const fixed = documentOf(fixAll(original).bytes);
    const body = elements(fixed, NS.w, "p").find(
      (p) => p.getAttributeNS(NS.w, "rsidR") === "00000002",
    )!;
    const find = (name: string) =>
      Array.from(body.getElementsByTagNameNS(NS.w, name));
    expect(find("r")).toHaveLength(5);
    expect(
      find("rFonts").map((el) => [
        el.getAttributeNS(NS.w, "ascii"),
        el.getAttributeNS(NS.w, "hAnsi"),
      ]),
    ).toEqual(
      Array.from({ length: 5 }, () => ["Times New Roman", "Times New Roman"]),
    );
    expect(find("sz").map((el) => el.getAttributeNS(NS.w, "val"))).toEqual(
      Array(5).fill("28"),
    );
    expect(find("spacing")[0].getAttributeNS(NS.w, "line")).toBe("360");
    expect(find("spacing")[0].getAttributeNS(NS.w, "lineRule")).toBe("auto");
    expect(find("ind")[0].getAttributeNS(NS.w, "firstLine")).toBe("709");
    expect(find("jc")[0].getAttributeNS(NS.w, "val")).toBe("both");
    expect(find("rStyle").map((el) => el.getAttributeNS(NS.w, "val"))).toEqual([
      "Strong",
      "Emphasis",
    ]);
  });

  it("preserves complex subtrees and all section metadata except selected margin distances", () => {
    const original = createAcademicFixture(),
      fixed = fixAll(original).bytes;
    for (const name of [
      "tbl",
      "numPr",
      "bookmarkStart",
      "bookmarkEnd",
      "hyperlink",
      "commentRangeStart",
      "commentRangeEnd",
      "commentReference",
      "footnoteReference",
      "endnoteReference",
      "pgSz",
      "pgNumType",
      "titlePg",
      "headerReference",
      "footerReference",
      "cols",
      "docGrid",
    ])
      // Hyperlinks contain editable ordinary-text runs; their wrapper and targets
      // are separately verified rather than treating their fonts as immutable.
      if (name !== "hyperlink")
        expect(snapshots(documentOf(fixed), name), name).toEqual(
          snapshots(documentOf(original), name),
        );
    for (const [name, ns] of [
      ["inline", NS.wp],
      ["anchor", NS.wp],
      ["oMath", NS.m],
    ])
      expect(snapshots(documentOf(fixed), name, ns), name).toEqual(
        snapshots(documentOf(original), name, ns),
      );
    expect(
      elements(documentOf(fixed), NS.w, "pgMar").map((el) =>
        ["left", "right", "top", "bottom", "header", "footer", "gutter"].map(
          (key) => el.getAttributeNS(NS.w, key),
        ),
      ),
    ).toEqual(
      Array.from({ length: 3 }, () => [
        "1701",
        "850",
        "1134",
        "1134",
        "567",
        "600",
        "113",
      ]),
    );
    expect(
      elements(documentOf(fixed), NS.w, "hyperlink").map((el) =>
        el.getAttributeNS(NS.r, "id"),
      ),
    ).toEqual(
      elements(documentOf(original), NS.w, "hyperlink").map((el) =>
        el.getAttributeNS(NS.r, "id"),
      ),
    );
  });

  it("is byte-for-byte idempotent after reopening a fixed package", () => {
    const first = fixAll(createAcademicFixture());
    const second = fixAll(first.bytes);
    expect(second.fixedCount).toBe(0);
    expect(second.bytes).toEqual(first.bytes);
    expect(second.report).toEqual(first.report);
    assertPackageIntegrity(second.bytes);
  });

  it("changes only margins when the user selects only the page rule", () => {
    const original = createAcademicFixture();
    const result = fixDocument(original, DEFAULT_PROFILE, ["page.margins"]);
    expect(result.fixedCount).toBe(1);
    for (const name of ["p", "tbl"])
      if (name === "tbl")
        expect(snapshots(documentOf(result.bytes), name)).toEqual(
          snapshots(documentOf(original), name),
        );
    const before = documentOf(original),
      after = documentOf(result.bytes);
    for (const doc of [before, after])
      for (const margin of elements(doc, NS.w, "pgMar"))
        for (const attr of ["left", "right", "top", "bottom"])
          margin.removeAttributeNS(NS.w, attr);
    expect(serialize(after)).toBe(serialize(before));
    expect(
      result.report.issues.filter((issue) => issue.fixable).length,
    ).toBeGreaterThan(0);
  });

  it("handles a 6000-paragraph document without dropping/splitting runs or accumulating properties", () => {
    const original = createLongTextFixture();
    const fixed = fixAll(original);
    expect(fixed.report.stats.paragraphs).toBe(6000);
    expect(fixed.report.issues.filter((issue) => issue.fixable)).toHaveLength(
      0,
    );
    const before = documentOf(original),
      after = documentOf(fixed.bytes);
    expect(allTextNodes(after)).toEqual(allTextNodes(before));
    expect(snapshots(after, "b")).toEqual(snapshots(before, "b"));
    expect(snapshots(after, "i")).toEqual(snapshots(before, "i"));
    expect(elements(after, NS.w, "r")).toHaveLength(12000);
    expect(fixAll(fixed.bytes).bytes).toEqual(fixed.bytes);
    assertPackageIntegrity(fixed.bytes);
  }, 60_000);

  it("exports the same original/fixed corpus for independent compatibility tools", () => {
    const dir = process.env.NORMA_CORPUS_DIR || "/tmp/norma-hardening/corpus";
    mkdirSync(dir, { recursive: true });
    const original = createAcademicFixture();
    writeFileSync(path.join(dir, "academic-original.docx"), original);
    writeFileSync(
      path.join(dir, "academic-fixed.docx"),
      fixAll(original).bytes,
    );
  });
});
