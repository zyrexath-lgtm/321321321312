import {
  DOMParser,
  XMLSerializer,
  type Document,
  type Element,
  type Node,
} from "@xmldom/xmldom";

export type XmlDocument = Document;
export type XmlElement = Element;
export type XmlNode = Node;
export const WORD_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const STRICT_WORD_NS =
  "http://purl.oclc.org/ooxml/wordprocessingml/main";
export const isWord = (el: Element, name?: string) =>
  (el.namespaceURI === WORD_NS || el.namespaceURI === STRICT_WORD_NS) &&
  (!name || el.localName === name);

export function decodeXml(bytes: Uint8Array): string {
  try {
    const utf16LE =
      (bytes[0] === 0xff && bytes[1] === 0xfe) ||
      (bytes[0] === 0x3c && bytes[1] === 0);
    const utf16BE =
      (bytes[0] === 0xfe && bytes[1] === 0xff) ||
      (bytes[0] === 0 && bytes[1] === 0x3c);
    return new TextDecoder(
      utf16LE ? "utf-16le" : utf16BE ? "utf-16be" : "utf-8",
      { fatal: true },
    ).decode(bytes);
  } catch {
    throw new Error(
      "Не удалось прочитать XML документа. Пересохраните работу в формате DOCX в Word или LibreOffice.",
    );
  }
}

export function parseXml(bytes: Uint8Array, name: string): Document {
  if (bytes.length > 16 * 1024 * 1024)
    throw new Error(
      "Слишком сложная XML-структура документа. Разделите работу на несколько файлов.",
    );
  const xml = decodeXml(bytes);
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(xml))
    throw new Error(
      "Документ содержит неподдерживаемые XML-объявления. Для безопасности обработка остановлена.",
    );
  // Bound nesting before handing untrusted XML to a recursive DOM implementation.
  let depth = 0,
    nodes = 0;
  const tags =
    xml.match(
      /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<(?:"[^"]*"|'[^']*'|[^'">])*>/g,
    ) ?? [];
  for (const tag of tags) {
    if (tag.startsWith("<?") || tag.startsWith("<!")) continue;
    if (tag.startsWith("</")) depth--;
    else {
      nodes++;
      if (!tag.endsWith("/>")) depth++;
    }
    if (depth < 0) throw new Error(`Повреждена структура DOCX (${name}).`);
    if (depth > 120 || nodes > 220_000)
      throw new Error(
        "Документ слишком сложный для безопасной обработки в браузере.",
      );
  }
  try {
    const parsed = new DOMParser({
      onError() {
        throw new Error("Invalid XML");
      },
    }).parseFromString(xml, "application/xml");
    if (!parsed.documentElement) throw new Error("No root");
    return parsed;
  } catch {
    throw new Error(
      `Повреждена структура DOCX (${name}). Откройте документ в Word или LibreOffice и сохраните заново.`,
    );
  }
}

export function serializeXml(doc: Document): Uint8Array {
  const serialized = new XMLSerializer()
    .serializeToString(doc)
    .replace(/(<\?xml[^?]*encoding\s*=\s*["'])[^"']+(["'])/i, "$1UTF-8$2");
  return new TextEncoder().encode(serialized);
}

export function children(parent: Node, name?: string): Element[] {
  const result: Element[] = [];
  for (let n = parent.firstChild; n; n = n.nextSibling)
    if (n.nodeType === 1 && isWord(n as Element, name))
      result.push(n as Element);
  return result;
}

export function child(
  parent: Node | null | undefined,
  name: string,
): Element | undefined {
  if (!parent) return undefined;
  return children(parent, name)[0];
}

export function descendants(parent: Node, name?: string): Element[] {
  const result: Element[] = [],
    stack: Node[] = [];
  for (let n = parent.lastChild; n; n = n.previousSibling) stack.push(n);
  while (stack.length) {
    const n = stack.pop()!;
    if (n.nodeType === 1 && isWord(n as Element, name))
      result.push(n as Element);
    for (let sub = n.lastChild; sub; sub = sub.previousSibling) stack.push(sub);
  }
  return result;
}

export function attr(
  el: Element | null | undefined,
  name: string,
): string | undefined {
  if (!el) return undefined;
  const ns = el.namespaceURI === STRICT_WORD_NS ? STRICT_WORD_NS : WORD_NS;
  return el.hasAttributeNS(ns, name)
    ? (el.getAttributeNS(ns, name) ?? undefined)
    : undefined;
}

export function setAttr(
  el: Element,
  name: string,
  value: string | number,
): void {
  const ns = el.namespaceURI === STRICT_WORD_NS ? STRICT_WORD_NS : WORD_NS;
  el.setAttributeNS(ns, `${el.prefix || "w"}:${name}`, String(value));
}

export function removeAttr(el: Element, name: string): void {
  el.removeAttributeNS(
    el.namespaceURI === STRICT_WORD_NS ? STRICT_WORD_NS : WORD_NS,
    name,
  );
}

const PROP_ORDER: Record<string, string[]> = {
  pPr: [
    "pStyle",
    "keepNext",
    "keepLines",
    "pageBreakBefore",
    "framePr",
    "widowControl",
    "numPr",
    "suppressLineNumbers",
    "pBdr",
    "shd",
    "tabs",
    "suppressAutoHyphens",
    "kinsoku",
    "wordWrap",
    "overflowPunct",
    "topLinePunct",
    "autoSpaceDE",
    "autoSpaceDN",
    "bidi",
    "adjustRightInd",
    "snapToGrid",
    "spacing",
    "ind",
    "contextualSpacing",
    "mirrorIndents",
    "suppressOverlap",
    "jc",
    "textDirection",
    "textAlignment",
    "textboxTightWrap",
    "outlineLvl",
    "divId",
    "cnfStyle",
    "rPr",
    "sectPr",
    "pPrChange",
  ],
  rPr: [
    "rStyle",
    "rFonts",
    "b",
    "bCs",
    "i",
    "iCs",
    "caps",
    "smallCaps",
    "strike",
    "dstrike",
    "outline",
    "shadow",
    "emboss",
    "imprint",
    "noProof",
    "snapToGrid",
    "vanish",
    "webHidden",
    "color",
    "spacing",
    "w",
    "kern",
    "position",
    "sz",
    "szCs",
    "highlight",
    "u",
    "effect",
    "bdr",
    "shd",
    "fitText",
    "vertAlign",
    "rtl",
    "cs",
    "em",
    "lang",
    "eastAsianLayout",
    "specVanish",
    "oMath",
    "rPrChange",
  ],
  sectPr: [
    "headerReference",
    "footerReference",
    "footnotePr",
    "endnotePr",
    "type",
    "pgSz",
    "pgMar",
    "paperSrc",
    "pgBorders",
    "lnNumType",
    "pgNumType",
    "cols",
    "formProt",
    "vAlign",
    "noEndnote",
    "titlePg",
    "textDirection",
    "bidi",
    "rtlGutter",
    "docGrid",
    "printerSettings",
    "sectPrChange",
  ],
};

/** Insert OOXML properties in schema order, preserving every existing child. */
export function ensureChild(parent: Element, name: string): Element {
  const existing = child(parent, name);
  if (existing) return existing;
  const ns = parent.namespaceURI === STRICT_WORD_NS ? STRICT_WORD_NS : WORD_NS;
  const el = parent.ownerDocument!.createElementNS(
    ns,
    `${parent.prefix || "w"}:${name}`,
  );
  if (name === "pPr" || name === "rPr")
    parent.insertBefore(el, parent.firstChild);
  else {
    const order = PROP_ORDER[parent.localName || ""];
    const index = order?.indexOf(name) ?? -1;
    const next =
      index < 0
        ? undefined
        : children(parent).find(
            (c) => order.indexOf(c.localName || "") > index,
          );
    parent.insertBefore(el, next ?? null);
  }
  return el;
}

export const paragraphText = (p: Element) =>
  descendants(p, "t")
    .map((t) => t.textContent ?? "")
    .join("");
