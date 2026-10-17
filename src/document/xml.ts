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
    const encoding = utf16LE ? "utf-16le" : utf16BE ? "utf-16be" : "utf-8";
    const decoded = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    const declared = /^<\?xml\s[^?]*\bencoding\s*=\s*["']([^"']+)["']/i
      .exec(decoded)?.[1]
      ?.toLowerCase();
    if (
      declared &&
      declared !== encoding &&
      !(declared === "utf-16" && (utf16LE || utf16BE))
    )
      throw new Error("Unsupported or inconsistent XML encoding");
    return decoded;
  } catch {
    throw new Error(
      "Не удалось прочитать XML документа. Пересохраните работу в формате DOCX в Word или LibreOffice.",
    );
  }
}

const XML_NAME =
  /^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}.\-0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/u;
const isXmlCharacter = (n: number) =>
  n === 9 ||
  n === 10 ||
  n === 13 ||
  (n >= 0x20 && n <= 0xd7ff) ||
  (n >= 0xe000 && n <= 0xfffd) ||
  (n >= 0x10000 && n <= 0x10ffff);

/** Linear, allocation-bounded preflight, also applied to XML parts we preserve. */
export function inspectXml(bytes: Uint8Array, name: string): string {
  if (bytes.length > 16 * 1024 * 1024)
    throw new Error(
      "Слишком сложная XML-структура документа. Разделите работу на несколько файлов.",
    );
  const xml = decodeXml(bytes);
  const invalid = () => {
    throw new Error(
      `Повреждена структура DOCX (${name}). Откройте документ в Word или LibreOffice и сохраните заново.`,
    );
  };
  const complexity = () => {
    throw new Error(
      "Документ слишком сложный для безопасной обработки в браузере.",
    );
  };
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(xml))
    invalid();
  const entities = (text: string) => {
    for (let at = text.indexOf("&"); at >= 0; at = text.indexOf("&", at + 1)) {
      const end = text.indexOf(";", at + 1);
      if (end < 0) invalid();
      const entity = text.slice(at + 1, end);
      if (["amp", "lt", "gt", "apos", "quot"].includes(entity)) continue;
      if (!/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(entity)) invalid();
      const n =
        entity[1] === "x"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      if (!isXmlCharacter(n)) invalid();
    }
  };
  const unescapeAttribute = (value: string) =>
    value
      .replace(/[\t\r\n]/g, " ")
      .replace(/&([^;]+);/g, (_, entity: string) => {
        const predefined: Record<string, string> = {
          amp: "&",
          lt: "<",
          gt: ">",
          apos: "'",
          quot: '"',
        };
        return (
          predefined[entity] ??
          String.fromCodePoint(
            entity[1] === "x"
              ? Number.parseInt(entity.slice(2), 16)
              : Number.parseInt(entity.slice(1), 10),
          )
        );
      });
  let at = 0,
    elements = 0,
    nodes = 0,
    attributes = 0,
    roots = 0;
  const XML_NS = "http://www.w3.org/XML/1998/namespace";
  const XMLNS_NS = "http://www.w3.org/2000/xmlns/";
  const namespaces = new Map<string, string>([
    ["xml", XML_NS],
    ["", ""],
  ]);
  type Scope = { name: string; changes: [string, string | undefined][] };
  const stack: Scope[] = [];
  const restoreNamespaces = (scope: Scope) => {
    for (const [prefix, old] of scope.changes) {
      if (old === undefined) namespaces.delete(prefix);
      else namespaces.set(prefix, old);
    }
  };
  const expandedName = (name: string, isAttribute: boolean) => {
    const parts = name.split(":");
    if (parts.length > 2 || parts.some((part) => !part || !XML_NAME.test(part)))
      invalid();
    const prefix = parts.length === 2 ? parts[0] : "";
    if (prefix === "xmlns" || (prefix && !namespaces.get(prefix))) invalid();
    return `${prefix || !isAttribute ? (namespaces.get(prefix) ?? "") : ""}\0${parts.at(-1)}`;
  };
  while (at < xml.length) {
    if (++nodes > 500_000) complexity();
    if (xml[at] !== "<") {
      const end = xml.indexOf("<", at);
      const text = xml.slice(at, end < 0 ? xml.length : end);
      if ((!stack.length && /[^ \t\r\n]/.test(text)) || text.includes("]]>"))
        invalid();
      entities(text);
      at = end < 0 ? xml.length : end;
      continue;
    }
    if (xml.startsWith("<!--", at)) {
      const end = xml.indexOf("-->", at + 4);
      const body = xml.slice(at + 4, end);
      if (end < 0 || body.includes("--") || body.endsWith("-")) invalid();
      at = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", at)) {
      const end = xml.indexOf("]]>", at + 9);
      if (end < 0 || !stack.length) invalid();
      at = end + 3;
      continue;
    }
    if (xml.startsWith("<?", at)) {
      const end = xml.indexOf("?>", at + 2);
      if (end < 0) invalid();
      const instruction = xml.slice(at + 2, end);
      const target = /^([^ \t\r\n?]+)/.exec(instruction)?.[1] ?? "";
      if (
        !XML_NAME.test(target) ||
        (target.toLowerCase() === "xml" && at !== 0)
      )
        invalid();
      if (
        target.toLowerCase() === "xml" &&
        !/^xml[ \t\r\n]+version[ \t\r\n]*=[ \t\r\n]*(?:"1\.0"|'1\.0')(?:[ \t\r\n]+encoding[ \t\r\n]*=[ \t\r\n]*(?:"[A-Za-z][A-Za-z0-9._-]*"|'[A-Za-z][A-Za-z0-9._-]*'))?(?:[ \t\r\n]+standalone[ \t\r\n]*=[ \t\r\n]*(?:"(?:yes|no)"|'(?:yes|no)'))?[ \t\r\n]*$/.test(
          instruction,
        )
      )
        invalid();
      at = end + 2;
      continue;
    }
    if (xml.startsWith("<!", at))
      throw new Error(
        "Документ содержит неподдерживаемые XML-объявления. Для безопасности обработка остановлена.",
      );
    let end = at + 1,
      quote = "";
    for (; end < xml.length; end++) {
      const c = xml[end];
      if (quote) {
        if (c === quote) quote = "";
        else if (c === "<") invalid();
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
      else if (c === "<") invalid();
    }
    if (end === xml.length || quote) invalid();
    const tag = xml.slice(at + 1, end);
    if (tag.startsWith("/")) {
      const closing = tag.slice(1).replace(/[ \t\r\n]+$/, "");
      const scope = stack.pop();
      if (!XML_NAME.test(closing) || scope?.name !== closing) invalid();
      restoreNamespaces(scope!);
    } else {
      const match = /^([^ \t\r\n/]+)([\s\S]*)$/.exec(tag);
      if (!match || !XML_NAME.test(match[1])) invalid();
      const tagName = match![1];
      const selfClosing = tag.endsWith("/");
      const rest = match![2].slice(0, selfClosing ? -1 : undefined);
      const names = new Set<string>();
      const values: [string, string][] = [];
      const attr =
        /[ \t\r\n]+([^ \t\r\n=/>]+)[ \t\r\n]*=[ \t\r\n]*(?:"([^"]*)"|'([^']*)')/y;
      let cursor = 0;
      while (cursor < rest.length && !/^[ \t\r\n]*$/.test(rest.slice(cursor))) {
        attr.lastIndex = cursor;
        const a = attr.exec(rest);
        if (!a || !XML_NAME.test(a[1]) || names.has(a[1])) invalid();
        names.add(a![1]);
        entities(a![2] ?? a![3]);
        values.push([a![1], a![2] ?? a![3]]);
        cursor = attr.lastIndex;
        if (names.size > 256 || ++attributes > 500_000) complexity();
      }
      const scope: Scope = { name: tagName, changes: [] };
      for (const [name, value] of values) {
        if (name !== "xmlns" && !name.startsWith("xmlns:")) continue;
        const prefix = name === "xmlns" ? "" : name.slice(6);
        const uri = unescapeAttribute(value);
        if (
          (name !== "xmlns" && !prefix) ||
          prefix.includes(":") ||
          prefix === "xmlns" ||
          uri === XMLNS_NS ||
          (prefix === "xml") !== (uri === XML_NS) ||
          (prefix && !uri) ||
          /\s/.test(uri)
        )
          invalid();
        scope.changes.push([prefix, namespaces.get(prefix)]);
        namespaces.set(prefix, uri);
      }
      expandedName(tagName, false);
      const expandedAttributes = new Set<string>();
      for (const [name] of values) {
        if (name === "xmlns" || name.startsWith("xmlns:")) continue;
        const expanded = expandedName(name, true);
        if (expandedAttributes.has(expanded)) invalid();
        expandedAttributes.add(expanded);
      }
      if (!stack.length && ++roots !== 1) invalid();
      if (++elements > 220_000) complexity();
      if (!selfClosing) stack.push(scope);
      else restoreNamespaces(scope);
      if (stack.length > 120) complexity();
    }
    at = end + 1;
  }
  if (stack.length || roots !== 1) invalid();
  return xml;
}

export function parseXml(bytes: Uint8Array, name: string): Document {
  const xml = inspectXml(bytes, name);
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
