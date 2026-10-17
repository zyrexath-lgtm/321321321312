import { describe, expect, it, vi } from "vitest";
import { deflateSync, strToU8, unzipSync, zipSync } from "fflate";
import { parseDocument, resolvePart } from "../src/document/parser";
import { inspectXml, parseXml, serializeXml } from "../src/document/xml";
import { analyzeDocument, fixDocument } from "../src/document/engine";
import { DEFAULT_PROFILE } from "../src/document/profile";
import { fixtureEntries } from "./fixtures";

const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const SIGN_REL =
  "http://schemas.openxmlformats.org/package/2006/relationships/digital-signature";
const types = () => fixtureEntries({ rich: false });
const crc32 = (data: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};
interface RawPart {
  name: string;
  data: Uint8Array;
  method?: number;
  flags?: number;
  declaredSize?: number;
  compressed?: Uint8Array;
  localCrc?: number;
  localSize?: number;
  localCompressedSize?: number;
  descriptor?: "signed" | "unsigned" | "corrupt" | "missing";
}
/** An independent small ZIP writer: lets tests forge metadata fflate won't produce. */
function rawZip(parts: RawPart[]): Uint8Array {
  const locals: Uint8Array[] = [],
    central: Uint8Array[] = [];
  let offset = 0;
  for (const part of parts) {
    const name = strToU8(part.name),
      method = part.method ?? 0;
    const data =
      part.compressed ?? (method === 8 ? deflateSync(part.data) : part.data);
    const flags = part.flags ?? (part.descriptor ? 8 : 0);
    const crc = crc32(part.data),
      size = part.declaredSize ?? part.data.length;
    const descriptorSize =
      part.descriptor && part.descriptor !== "missing"
        ? part.descriptor === "unsigned"
          ? 12
          : 16
        : 0;
    const local = new Uint8Array(
      30 + name.length + data.length + descriptorSize,
    );
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, flags, true);
    l.setUint16(8, method, true);
    l.setUint32(14, part.localCrc ?? (flags & 8 ? 0 : crc), true);
    l.setUint32(
      18,
      part.localCompressedSize ?? (flags & 8 ? 0 : data.length),
      true,
    );
    l.setUint32(22, part.localSize ?? (flags & 8 ? 0 : size), true);
    l.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    if (descriptorSize) {
      let at = 30 + name.length + data.length;
      if (descriptorSize === 16) {
        l.setUint32(at, 0x08074b50, true);
        at += 4;
      }
      l.setUint32(at, part.descriptor === "corrupt" ? crc ^ 1 : crc, true);
      l.setUint32(at + 4, data.length, true);
      l.setUint32(at + 8, size, true);
    }
    const dir = new Uint8Array(46 + name.length),
      d = new DataView(dir.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, flags, true);
    d.setUint16(10, method, true);
    d.setUint32(16, crc, true);
    d.setUint32(20, data.length, true);
    d.setUint32(24, size, true);
    d.setUint16(28, name.length, true);
    d.setUint32(42, offset, true);
    dir.set(name, 46);
    locals.push(local);
    central.push(dir);
    offset += local.length;
  }
  const directorySize = central.reduce((sum, x) => sum + x.length, 0);
  const zip = new Uint8Array(offset + directorySize + 22);
  let cursor = 0;
  for (const section of [...locals, ...central]) {
    zip.set(section, cursor);
    cursor += section.length;
  }
  const e = new DataView(zip.buffer, cursor);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, parts.length, true);
  e.setUint16(10, parts.length, true);
  e.setUint32(12, directorySize, true);
  e.setUint32(16, offset, true);
  return zip;
}
const rawParts = (): RawPart[] =>
  Object.entries(types()).map(([name, data]) => ({ name, data }));
const extra = (part: RawPart) => rawZip([...rawParts(), part]);
function centralRecords(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result: number[] = [];
  let at = view.getUint32(bytes.length - 6, true);
  const count = view.getUint16(bytes.length - 12, true);
  for (let i = 0; i < count; i++) {
    result.push(at);
    at +=
      46 +
      view.getUint16(at + 28, true) +
      view.getUint16(at + 30, true) +
      view.getUint16(at + 32, true);
  }
  return result;
}
const appendRel = (
  entries: Record<string, Uint8Array>,
  rel: string,
  source = "word/_rels/document.xml.rels",
) => {
  entries[source] = strToU8(
    new TextDecoder()
      .decode(entries[source])
      .replace("</Relationships>", `${rel}</Relationships>`),
  );
};

// These tests exercise the parser directly rather than using its own serializer as oracle.
describe("adversarial ZIP directory / payload agreement", () => {
  it.each([0, 8])(
    "accepts normal stored/deflated packages (method %i)",
    (method) => {
      const parsed = parseDocument(
        rawZip(rawParts().map((p) => ({ ...p, method }))),
      );
      expect(parsed.body.localName).toBe("body");
    },
  );
  it.each(["signed", "unsigned"] as const)(
    "accepts a valid %s data descriptor",
    (descriptor) => {
      const parsed = parseDocument(
        rawZip(rawParts().map((p) => ({ ...p, method: 8, descriptor }))),
      );
      expect(parsed.entries["word/document.xml"]).toEqual(
        types()["word/document.xml"],
      );
    },
  );
  it.each(["corrupt", "missing"] as const)(
    "rejects a %s data descriptor",
    (descriptor) => {
      expect(() =>
        parseDocument(
          extra({
            name: "custom.bin",
            data: strToU8("test"),
            method: 8,
            descriptor,
          }),
        ),
      ).toThrow(/дескриптор/i);
    },
  );
  it.each([
    { localCrc: 0 },
    { localSize: 1000 },
    { localCompressedSize: 1000 },
  ])("rejects conflicting local metadata %j", (override) => {
    expect(() =>
      parseDocument(
        extra({ name: "custom.bin", data: strToU8("test"), ...override }),
      ),
    ).toThrow();
  });
  it.each([
    "../escape.xml",
    "word/../escape.xml",
    "word/./a.xml",
    "/escape.xml",
    "C:/escape.xml",
    "word\\escape.xml",
    "word//escape.xml",
    "word/%2e%2e/a.xml",
    "word/%2Fa.xml",
    "word/%5ca.xml",
    "word/%00.xml",
    "word/zero\0.xml",
    "word/a?x.xml",
    "word/a#b.xml",
    "word/%zz.xml",
  ])("rejects an unsafe ZIP path %j", (name) => {
    expect(() =>
      parseDocument(extra({ name, data: strToU8("<x/>") })),
    ).toThrow();
  });
  it.each(["word/document.xml", "WORD/DOCUMENT.XML", "word/%64ocument.xml"])(
    "rejects duplicate logical part %s",
    (name) => {
      expect(() =>
        parseDocument(extra({ name, data: types()["word/document.xml"] })),
      ).toThrow(/неоднозначная/i);
    },
  );
  it.each([1, 64, 32, 8192])(
    "rejects encryption or unsupported flag %i",
    (flags) => {
      expect(() =>
        parseDocument(extra({ name: "custom.bin", data: strToU8("x"), flags })),
      ).toThrow();
    },
  );
  it("rejects unsupported compression", () => {
    expect(() =>
      parseDocument(
        extra({ name: "custom.bin", data: strToU8("x"), method: 99 }),
      ),
    ).toThrow(/сжатия/i);
  });
  it("rejects invalid UTF-8 ZIP names rather than silently using replacement characters", () => {
    const bytes = extra({
      name: "custom.bin",
      data: strToU8("x"),
      flags: 2048,
    });
    const view = new DataView(bytes.buffer),
      central = centralRecords(bytes).at(-1)!;
    const local = view.getUint32(central + 42, true);
    bytes[local + 30] = 0xff;
    bytes[central + 46] = 0xff;
    expect(() => parseDocument(bytes)).toThrow(/кодировка/i);
  });
  it("rejects entries assigned to a different disk", () => {
    const bytes = rawZip(rawParts()),
      view = new DataView(bytes.buffer);
    view.setUint16(centralRecords(bytes)[0] + 34, 1, true);
    expect(() => parseDocument(bytes)).toThrow();
  });
  it("rejects a forged CRC even when local and central records agree", () => {
    const bytes = extra({ name: "custom.bin", data: strToU8("test") }),
      view = new DataView(bytes.buffer);
    const central = centralRecords(bytes).at(-1)!;
    const local = view.getUint32(central + 42, true);
    view.setUint32(local + 14, 0, true);
    view.setUint32(central + 16, 0, true);
    expect(() => parseDocument(bytes)).toThrow(/целостность/i);
  });
  it("stops a deflate stream that expands beyond its declared size", () => {
    expect(() =>
      parseDocument(
        extra({
          name: "custom.bin",
          data: new Uint8Array(8 * 1024 * 1024),
          method: 8,
          declaredSize: 1,
        }),
      ),
    ).toThrow(/распаковать/i);
  });
  it("rejects excessive per-part and aggregate expansion claims before allocating", () => {
    for (const parts of [
      [
        {
          name: "huge.bin",
          data: new Uint8Array(1),
          declaredSize: 33 * 1024 * 1024,
        },
      ],
      Array.from({ length: 4 }, (_, i) => ({
        name: `huge${i}.bin`,
        data: new Uint8Array(1),
        declaredSize: 26 * 1024 * 1024,
      })),
    ])
      expect(() => parseDocument(rawZip([...rawParts(), ...parts]))).toThrow(
        /Распакованный/i,
      );
  });
  it("rejects overlapping local records hidden inside a stored payload", () => {
    const inner = rawZip([{ name: "inside.bin", data: strToU8("content") }]);
    const innerLocal = inner.subarray(0, centralRecords(inner)[0]);
    const parts = [
      ...rawParts(),
      { name: "outer.bin", data: innerLocal },
      { name: "inside.bin", data: strToU8("content") },
    ];
    const bytes = rawZip(parts),
      view = new DataView(bytes.buffer),
      dirs = centralRecords(bytes);
    const outer = dirs.at(-2)!,
      nested = dirs.at(-1)!;
    const outerLocal = view.getUint32(outer + 42, true);
    view.setUint32(nested + 42, outerLocal + 30 + "outer.bin".length, true);
    expect(() => parseDocument(bytes)).toThrow(/Перекрывающиеся/i);
  });
  it("rejects an empty, invalid deflate stream instead of treating it as an empty part", () => {
    expect(() =>
      parseDocument(
        extra({
          name: "custom.bin",
          data: new Uint8Array(),
          method: 8,
          compressed: new Uint8Array(),
        }),
      ),
    ).toThrow();
  });
  it("marks only genuinely incompressible media for output storage", () => {
    const compressed = new Uint8Array(100_000);
    const entries = types();
    entries["word/media/flat.png"] = compressed;
    const parsed = parseDocument(zipSync(entries));
    expect(parsed.alreadyCompressedParts?.has("word/media/flat.png")).toBe(
      false,
    );
    const stored = parseDocument(
      rawZip([
        ...rawParts(),
        { name: "word/media/stored.png", data: compressed },
      ]),
    );
    expect(stored.alreadyCompressedParts?.has("word/media/stored.png")).toBe(
      true,
    );
    expect(stored.alreadyCompressedParts?.has("word/document.xml")).toBe(false);
  });
});

describe("bounded XML parsing, including parts outside the main body", () => {
  it.each([
    '<!DOCTYPE x [<!ENTITY x SYSTEM "https://example.org/secret">]><x>&x;</x>',
    '<!ENTITY x "expansion"><x/>',
    "<x><y></x>",
    '<x a="1" a="2"/>',
    "<x:root/>",
    '<x xmlns:a="urn:test" xmlns:b="urn:test" a:key="1" b:key="2"/>',
    "<?xml?><x/>",
    '<?XML version="1.0"?><x/>',
    '<x xmlns:xml="urn:wrong"/>',
    '<x xmlns:a=""/>',
    '<x xmlns:a="http://www.w3.org/2000/xmlns/"/>',
    '<x xmlns:xmlns="urn:wrong"/>',
    '<x xmlns:a="http://www.w3.org/XML/1998/namespace"/>',
    '<x><a:y xmlns:a="urn:test"/><a:y/></x>',
    '<x a:b:c="invalid"/>',
    "<!--bad---><x/>",
    '<x xmlns:="urn:test"/>',
    "<x>&unknown;</x>",
    "<x>&#0;</x>",
    "<x>&#xD800;</x>",
    "<x>\u0000</x>",
    "<x/><y/>",
  ])("rejects unsafe or malformed preserved XML: %s", (xml) => {
    expect(() =>
      parseDocument(
        extra({ name: "customXml/unsafe.xml", data: strToU8(xml) }),
      ),
    ).toThrow();
  });
  it("does not mistake inert DTD-looking text in comments or CDATA for declarations", () => {
    const bytes = extra({
      name: "customXml/safe.xml",
      data: strToU8(
        '<x><!-- <!DOCTYPE harmless> --><![CDATA[<!ENTITY inert "text">]]></x>',
      ),
    });
    expect(parseDocument(bytes).entries["customXml/safe.xml"]).toBeTruthy();
  });
  it("rejects UTF-16 DTD/entity declarations without relying on byte-level ASCII matching", () => {
    const xml = '<!DOCTYPE x [<!ENTITY x "expand">]><x>&x;</x>';
    const bytes = new Uint8Array(2 + xml.length * 2),
      view = new DataView(bytes.buffer);
    view.setUint16(0, 0xfeff, true);
    for (let i = 0; i < xml.length; i++)
      view.setUint16(2 + i * 2, xml.charCodeAt(i), true);
    expect(() =>
      parseDocument(extra({ name: "customXml/utf16.xml", data: bytes })),
    ).toThrow();
  });
  it("checks XML MIME types even when a part is renamed to .bin", () => {
    const entries = types();
    entries["customXml/renamed.bin"] = strToU8(
      '<!DOCTYPE x [<!ENTITY dangerous "expand">]><x>&dangerous;</x>',
    );
    entries["[Content_Types].xml"] = strToU8(
      new TextDecoder()
        .decode(entries["[Content_Types].xml"])
        .replace(
          "</Types>",
          '<Override PartName="/customXml/renamed.bin" ContentType="application/custom+xml"/></Types>',
        ),
    );
    expect(() => parseDocument(zipSync(entries))).toThrow(/XML-объявления/i);
  });
  it.each([true, false])(
    "supports valid UTF-16 (little endian: %s), and serializes valid UTF-8",
    (little) => {
      const xml =
        '<?xml version="1.0" encoding="UTF-16"?><x>Кириллица λ 🎓</x>';
      const bytes = new Uint8Array(2 + xml.length * 2),
        view = new DataView(bytes.buffer);
      view.setUint16(0, 0xfeff, little);
      for (let i = 0; i < xml.length; i++)
        view.setUint16(2 + i * 2, xml.charCodeAt(i), little);
      const doc = parseXml(bytes, "utf16.xml"),
        output = serializeXml(doc);
      expect(parseXml(output, "utf8.xml").documentElement?.textContent).toBe(
        "Кириллица λ 🎓",
      );
    },
  );
  it("rejects invalid UTF-8 and inconsistent declared encodings", () => {
    expect(() =>
      inspectXml(
        new Uint8Array([60, 120, 62, 0xc0, 0xaf, 60, 47, 120, 62]),
        "invalid.xml",
      ),
    ).toThrow();
    expect(() =>
      inspectXml(
        strToU8('<?xml version="1.0" encoding="UTF-16"?><x/>'),
        "encoding.xml",
      ),
    ).toThrow();
  });
  it("rejects oversized XML in preserved package parts", () => {
    const data = strToU8(`<x>${" ".repeat(16 * 1024 * 1024)}</x>`);
    expect(() =>
      parseDocument(
        extra({ name: "customXml/oversized.xml", data, method: 8 }),
      ),
    ).toThrow(/XML-структура/i);
  });
  it("bounds nesting, element count and attribute count before DOM allocation", () => {
    const cases = [
      `<x>${"<y>".repeat(121)}${"</y>".repeat(121)}</x>`,
      `<x>${"<y/>".repeat(220_001)}</x>`,
      `<x ${Array.from({ length: 257 }, (_, i) => `a${i}="x"`).join(" ")}/>`,
      `<x>${"<!--a-->".repeat(500_001)}</x>`,
    ];
    for (const xml of cases)
      expect(() => inspectXml(strToU8(xml), "complex.xml")).toThrow(/сложный/i);
  });
  it("rejects an unfinished tag without quadratic regex rescans", () => {
    expect(() =>
      inspectXml(strToU8(`<x>${"<".repeat(1_000_000)}`), "unfinished.xml"),
    ).toThrow();
  });
});

describe("OPC relationship integrity and active-content handling", () => {
  it.each([
    `<Relationship Id="rIdStyles" Type="${OFFICE_REL}/styles" Target="styles.xml"/>`,
    `<Relationship Id="missing" Type="${OFFICE_REL}/image" Target="media/missing.png"/>`,
    `<Relationship Id="invalid-mode" Type="${OFFICE_REL}/image" Target="media/image1.png" TargetMode="external"/>`,
    `<Relationship Id="escape" Type="${OFFICE_REL}/image" Target="../../outside.bin"/>`,
    `<Relationship Id="encoded-escape" Type="${OFFICE_REL}/image" Target="%2e%2e/outside.bin"/>`,
    `<Relationship Id="empty" Type="${OFFICE_REL}/image" Target=""/>`,
    `<Relationship Id="invalidType" Type="not-an-absolute-uri" Target="styles.xml"/>`,
  ])("rejects malformed relationships anywhere in the package: %s", (rel) => {
    const entries = types();
    appendRel(entries, rel);
    expect(() => parseDocument(zipSync(entries))).toThrow();
  });
  it("validates orphan relationship parts", () => {
    const entries = types();
    entries["word/_rels/missing.xml.rels"] = strToU8(
      `<Relationships xmlns="${REL_NS}"/>`,
    );
    expect(() => parseDocument(zipSync(entries))).toThrow(/принадлежат связи/i);
  });
  it("resolves OPC part references case-insensitively without renaming the saved ZIP parts", () => {
    const entries = types();
    entries["_rels/.rels"] = strToU8(
      new TextDecoder()
        .decode(entries["_rels/.rels"])
        .replace('Target="word/document.xml"', 'Target="WORD/DOCUMENT.XML"'),
    );
    entries["word/_rels/document.xml.rels"] = strToU8(
      new TextDecoder()
        .decode(entries["word/_rels/document.xml.rels"])
        .replace('Target="styles.xml"', 'Target="STYLES.XML"'),
    );
    const original = zipSync(entries),
      report = analyzeDocument(original, DEFAULT_PROFILE);
    const fixed = fixDocument(
      original,
      DEFAULT_PROFILE,
      report.issues.filter((i) => i.fixable).map((i) => i.id),
    );
    expect(parseDocument(fixed.bytes).mainPath).toBe("word/document.xml");
    expect(unzipSync(fixed.bytes)["_rels/.rels"]).toEqual(
      entries["_rels/.rels"],
    );
  });
  it("rejects duplicate content-type overrides for the same logical part", () => {
    const entries = types();
    entries["[Content_Types].xml"] = strToU8(
      new TextDecoder()
        .decode(entries["[Content_Types].xml"])
        .replace(
          "</Types>",
          '<Override PartName="/WORD/DOCUMENT.XML" ContentType="application/xml"/></Types>',
        ),
    );
    expect(() => parseDocument(zipSync(entries))).toThrow(
      /Неоднозначные типы/i,
    );
  });
  it("does not treat an unknown URI ending in officeDocument as the standard package relationship", () => {
    const entries = types();
    entries["_rels/.rels"] = strToU8(
      new TextDecoder()
        .decode(entries["_rels/.rels"])
        .replace(
          `${OFFICE_REL}/officeDocument`,
          "https://unrelated.invalid/officeDocument",
        ),
    );
    expect(() => parseDocument(zipSync(entries))).toThrow(/основной документ/i);
  });
  it("validates relationships on preserved headers, rather than only main/styles/theme", () => {
    const entries = types();
    entries["word/_rels/header1.xml.rels"] = strToU8(
      `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/image" Target="media/missing.png"/></Relationships>`,
    );
    expect(() => parseDocument(zipSync(entries))).toThrow(
      /отсутствует внутренняя/i,
    );
  });
  it.each([
    `${OFFICE_REL}/vbaProject`,
    `${OFFICE_REL}/control`,
    "http://schemas.microsoft.com/office/2006/relationships/activeXControlBinary",
    `${SIGN_REL}/signature`,
    `${SIGN_REL}/origin`,
  ])(
    "detects active or signed content even when its payload is renamed: %s",
    (type) => {
      const entries = types();
      entries["word/renamed.bin"] = new Uint8Array([1, 2, 3]);
      appendRel(
        entries,
        `<Relationship Id="renamed" Type="${type}" Target="renamed.bin"/>`,
      );
      expect(() => parseDocument(zipSync(entries))).toThrow(/Макросы|подписи/i);
    },
  );
  it("preserves external relationships byte-for-byte, never fetches them, and warns", () => {
    const entries = types();
    appendRel(
      entries,
      `<Relationship Id="external-image" Type="${OFFICE_REL}/image" Target="file:///private/untrusted.png" TargetMode="External"/>`,
    );
    const bytes = zipSync(entries),
      fetch = vi.spyOn(globalThis, "fetch");
    try {
      const before = analyzeDocument(bytes, DEFAULT_PROFILE);
      expect(before.warnings.some((w) => w.includes("Внешние ссылки"))).toBe(
        true,
      );
      const fixed = fixDocument(
        bytes,
        DEFAULT_PROFILE,
        before.issues.filter((i) => i.fixable).map((i) => i.id),
      );
      const reopened = parseDocument(fixed.bytes);
      expect(reopened.entries["word/_rels/document.xml.rels"]).toEqual(
        entries["word/_rels/document.xml.rels"],
      );
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
  it("allows normal relative targets, package-absolute targets, and valid bookmark fragments", () => {
    const entries = types();
    appendRel(
      entries,
      `<Relationship Id="absolute" Type="${OFFICE_REL}/image" Target="/word/media/image1.png"/><Relationship Id="fragment" Type="${OFFICE_REL}/hyperlink" Target="#bookmark"/>`,
    );
    expect(parseDocument(zipSync(entries)).body.localName).toBe("body");
    expect(resolvePart("word/document.xml", "../docProps/core.xml")).toBe(
      "docProps/core.xml",
    );
  });
  it("preserves safe embedded packages, without parsing or executing their payload", () => {
    const entries = types();
    entries["word/embeddings/sheet.xlsx"] = zipSync({
      "[Content_Types].xml": strToU8("<Types/>"),
    });
    appendRel(
      entries,
      `<Relationship Id="embedded" Type="${OFFICE_REL}/package" Target="embeddings/sheet.xlsx"/>`,
    );
    const bytes = zipSync(entries),
      parsed = parseDocument(bytes);
    expect(parsed.entries["word/embeddings/sheet.xlsx"]).toEqual(
      entries["word/embeddings/sheet.xlsx"],
    );
    expect(unzipSync(bytes)["word/embeddings/sheet.xlsx"]).toEqual(
      entries["word/embeddings/sheet.xlsx"],
    );
  });
});
