import { Inflate, strFromU8 } from "fflate";
import {
  parseXml,
  decodeXml,
  isWord,
  child,
  descendants,
  type XmlDocument,
  type XmlElement,
} from "./xml";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 100 * 1024 * 1024;
const OFFICE_REL = /\/(officeDocument)$/;
const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

interface EntryMeta {
  name: string;
  size: number;
  compressedSize: number;
  crc: number;
  dataAt: number;
  method: number;
}
export interface ParsedDocument {
  entries: Record<string, Uint8Array>;
  mainPath: string;
  document: XmlDocument;
  body: XmlElement;
  styles?: XmlDocument;
  theme?: XmlDocument;
  warnings: string[];
}

function preflight(bytes: Uint8Array): { metadata: EntryMeta[]; end: number } {
  if (!(bytes instanceof Uint8Array) || bytes.length < 22)
    throw new Error(
      "Это не DOCX или файл повреждён. Выберите документ в формате .docx.",
    );
  if (bytes.length > MAX_FILE_BYTES)
    throw new Error(
      "Файл больше 25 МБ. Уменьшите размер изображений или разделите документ.",
    );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x04034b50)
    throw new Error(
      "Это не DOCX. Старый формат .doc, PDF и защищённые паролем документы не поддерживаются.",
    );
  let end = -1;
  for (
    let i = bytes.length - 22;
    i >= Math.max(0, bytes.length - 65_557);
    i--
  ) {
    if (
      view.getUint32(i, true) === 0x06054b50 &&
      i + 22 + view.getUint16(i + 20, true) === bytes.length
    ) {
      end = i;
      break;
    }
  }
  if (end < 0)
    throw new Error(
      "DOCX повреждён: не найден каталог ZIP. Сохраните документ заново.",
    );
  const count = view.getUint16(end + 10, true),
    centralSize = view.getUint32(end + 12, true),
    centralStart = view.getUint32(end + 16, true);
  if (
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0 ||
    count !== view.getUint16(end + 8, true) ||
    count === 0xffff ||
    centralStart === 0xffffffff ||
    centralSize === 0xffffffff
  )
    throw new Error(
      "Многотомные архивы и ZIP64 не поддерживаются. Пересохраните документ как обычный DOCX.",
    );
  if (count > 2048 || centralStart + centralSize !== end)
    throw new Error(
      "Нестандартная или слишком сложная структура DOCX. Обработка остановлена.",
    );
  const entries: EntryMeta[] = [],
    names = new Set<string>();
  let at = centralStart,
    expanded = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50)
      throw new Error(
        "Повреждён каталог DOCX. Пересохраните файл в текстовом редакторе.",
      );
    const flags = view.getUint16(at + 8, true),
      method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true),
      size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true),
      extraLen = view.getUint16(at + 30, true),
      commentLen = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    if (at + 46 + nameLen + extraLen + commentLen > end)
      throw new Error("Повреждён каталог DOCX.");
    const name = strFromU8(
      bytes.subarray(at + 46, at + 46 + nameLen),
      !(flags & 2048),
    );
    if (flags & 1 || flags & 64)
      throw new Error(
        "Документы с паролем не поддерживаются. Снимите защиту и загрузите копию.",
      );
    if (method !== 0 && method !== 8)
      throw new Error(
        "Неподдерживаемый способ сжатия DOCX. Сохраните копию через Word или LibreOffice.",
      );
    if (
      !name ||
      name.includes("\\") ||
      name.includes("\0") ||
      name.startsWith("/") ||
      name.split("/").some((part) => part === ".." || part === ".") ||
      names.has(name)
    )
      throw new Error("Небезопасная или неоднозначная структура архива DOCX.");
    if (/_xmlsignatures\//i.test(name))
      throw new Error(
        "Документ подписан цифровой подписью. Исправление нарушит подпись; используйте неподписанную копию.",
      );
    if (/vbaproject\.bin$|vbasignature\.bin$|activex\//i.test(name))
      throw new Error(
        "Документы с макросами или ActiveX не поддерживаются. Сохраните безопасную копию .docx.",
      );
    expanded += size;
    if (
      size > 32 * 1024 * 1024 ||
      expanded > MAX_EXPANDED_BYTES ||
      compressedSize === 0xffffffff ||
      size === 0xffffffff
    )
      throw new Error(
        "Распакованный документ слишком большой. Для безопасности лимит составляет 100 МБ.",
      );
    if (
      localAt + 30 > centralStart ||
      view.getUint32(localAt, true) !== 0x04034b50
    )
      throw new Error("Повреждена структура ZIP внутри DOCX.");
    const localNameLen = view.getUint16(localAt + 26, true),
      localExtraLen = view.getUint16(localAt + 28, true);
    const dataAt = localAt + 30 + localNameLen + localExtraLen;
    const localName = strFromU8(
      bytes.subarray(localAt + 30, localAt + 30 + localNameLen),
      !(flags & 2048),
    );
    if (
      dataAt + compressedSize > centralStart ||
      localName !== name ||
      view.getUint16(localAt + 8, true) !== method ||
      view.getUint16(localAt + 6, true) !== flags
    )
      throw new Error("Несогласованная структура ZIP внутри DOCX.");
    names.add(name);
    entries.push({
      name,
      size,
      compressedSize,
      crc: view.getUint32(at + 16, true),
      dataAt,
      method,
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  if (at !== end) throw new Error("Повреждён каталог ZIP внутри DOCX.");
  return { metadata: entries, end };
}

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++)
    c = crcTable[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function resolvePart(basePath: string, target: string): string {
  if (
    /^[a-z][a-z\d+.-]*:/i.test(target) ||
    target.includes("\\") ||
    target.includes("?") ||
    target.includes("#")
  )
    throw new Error("Неподдерживаемая ссылка на часть документа.");
  const segments = target.startsWith("/")
    ? []
    : basePath.split("/").slice(0, -1);
  for (const part of target.replace(/^\//, "").split("/")) {
    if (part === "..") {
      if (!segments.length) throw new Error("Некорректная ссылка внутри DOCX.");
      segments.pop();
    } else if (part && part !== ".") segments.push(part);
  }
  return segments.join("/");
}

function relationships(doc: XmlDocument): XmlElement[] {
  if (
    doc.documentElement?.namespaceURI !== REL_NS ||
    doc.documentElement.localName !== "Relationships"
  )
    throw new Error("Некорректные связи внутри DOCX.");
  const result: XmlElement[] = [];
  for (
    let node = doc.documentElement.firstChild;
    node;
    node = node.nextSibling
  ) {
    if (
      node.nodeType === 1 &&
      (node as XmlElement).namespaceURI === REL_NS &&
      (node as XmlElement).localName === "Relationship"
    )
      result.push(node as XmlElement);
  }
  return result;
}

export function parseDocument(bytes: Uint8Array): ParsedDocument {
  const { metadata } = preflight(bytes);
  // Extract ONLY the directory entries already checked above. A second ZIP parser
  // could select a forged EOCD/ZIP64 directory hidden in an archive comment.
  const entries: Record<string, Uint8Array> = Object.create(null);
  try {
    for (const entry of metadata) {
      if (entry.method === 0) {
        if (entry.size !== entry.compressedSize)
          throw new Error("Stored size mismatch");
        entries[entry.name] = bytes.slice(
          entry.dataAt,
          entry.dataAt + entry.size,
        );
        continue;
      }
      const result = new Uint8Array(entry.size);
      let written = 0;
      const inflate = new Inflate((chunk) => {
        if (written + chunk.length > entry.size)
          throw new Error("Expansion limit exceeded");
        result.set(chunk, written);
        written += chunk.length;
      });
      // Bounded compressed chunks stop dishonest streams before unbounded expansion.
      const end = entry.dataAt + entry.compressedSize;
      for (let at = entry.dataAt; at < end; at += 4096)
        inflate.push(
          bytes.subarray(at, Math.min(at + 4096, end)),
          at + 4096 >= end,
        );
      if (written !== entry.size) throw new Error("Expanded size mismatch");
      entries[entry.name] = result;
    }
  } catch {
    throw new Error(
      "Не удалось распаковать DOCX. Файл повреждён или использует неподдерживаемое сжатие.",
    );
  }
  for (const entry of metadata) {
    const file = entries[entry.name];
    if (!file || file.length !== entry.size || crc32(file) !== entry.crc)
      throw new Error(
        "Нарушена целостность DOCX. Откройте исходный документ и сохраните новую копию.",
      );
    if (
      /\.(xml|rels)$/i.test(entry.name) &&
      /<!\s*(DOCTYPE|ENTITY)\b/i.test(decodeXml(file))
    )
      throw new Error(
        "Документ содержит небезопасные XML-объявления. Обработка остановлена.",
      );
  }
  const typesBytes = entries["[Content_Types].xml"],
    rootRels = entries["_rels/.rels"];
  if (!typesBytes || !rootRels)
    throw new Error(
      "Это ZIP-архив, но не документ DOCX. Выберите файл, сохранённый в Word или LibreOffice.",
    );
  const types = parseXml(typesBytes, "[Content_Types].xml");
  if (
    types.documentElement?.localName !== "Types" ||
    types.documentElement.namespaceURI !==
      "http://schemas.openxmlformats.org/package/2006/content-types"
  )
    throw new Error("Неверный формат пакета DOCX.");
  const mainRel = relationships(parseXml(rootRels, "_rels/.rels")).find((el) =>
    OFFICE_REL.test(el.getAttribute("Type") || ""),
  );
  if (!mainRel || mainRel.getAttribute("TargetMode") === "External")
    throw new Error("В DOCX не найден основной документ.");
  const mainPath = resolvePart("", mainRel.getAttribute("Target") || "");
  const typeElements = types.getElementsByTagNameNS(
    "http://schemas.openxmlformats.org/package/2006/content-types",
    "*",
  );
  let validMainType = false;
  for (let i = 0; i < typeElements.length; i++) {
    const el = typeElements.item(i)!;
    const contentType = el.getAttribute("ContentType") || "";
    if (/macroEnabled|vbaProject|digital-signature|activeX/i.test(contentType))
      throw new Error(
        "Макросы, ActiveX и цифровые подписи не поддерживаются. Используйте обычную неподписанную копию DOCX.",
      );
    if (
      el.localName === "Override" &&
      el.getAttribute("PartName") === `/${mainPath}` &&
      contentType === DOCX_CONTENT_TYPE
    )
      validMainType = true;
  }
  if (!validMainType || !entries[mainPath])
    throw new Error(
      "Не найден основной XML документа DOCX. Шаблоны и документы с макросами не поддерживаются.",
    );
  const document = parseXml(entries[mainPath], mainPath);
  if (
    !document.documentElement ||
    !isWord(document.documentElement, "document")
  )
    throw new Error("Основная часть DOCX содержит неверную структуру.");
  const body = child(document.documentElement, "body");
  if (!body) throw new Error("В DOCX отсутствует содержимое документа.");
  // Complex revisions and read-only protection must never be silently bypassed.
  const warnings: string[] = [];
  if (
    descendants(body).some((el) =>
      [
        "ins",
        "del",
        "moveFrom",
        "moveTo",
        "pPrChange",
        "rPrChange",
        "sectPrChange",
      ].includes(el.localName || ""),
    )
  )
    warnings.push(
      "В документе есть исправления рецензента. Соответствующие фрагменты оставлены без изменений.",
    );
  const relPath =
    `${mainPath.split("/").slice(0, -1).join("/")}/_rels/${mainPath.split("/").at(-1)}.rels`.replace(
      /^\//,
      "",
    );
  let styles: XmlDocument | undefined, theme: XmlDocument | undefined;
  if (entries[relPath]) {
    const rels = relationships(parseXml(entries[relPath], relPath));
    for (const kind of ["styles", "theme", "settings"] as const) {
      const rel = rels.find((r) =>
        (r.getAttribute("Type") || "").endsWith(`/${kind}`),
      );
      if (!rel || rel.getAttribute("TargetMode") === "External") continue;
      const target = resolvePart(mainPath, rel.getAttribute("Target") || "");
      if (!entries[target])
        throw new Error(`В DOCX отсутствует связанная часть: ${kind}.`);
      const parsed = parseXml(entries[target], target);
      if (kind === "styles") styles = parsed;
      if (kind === "theme") theme = parsed;
      if (kind === "settings") {
        const protection = descendants(parsed, "documentProtection")[0];
        const enforcement = protection?.getAttributeNS(
          protection.namespaceURI,
          "enforcement",
        );
        if (enforcement && !["0", "false", "off"].includes(enforcement))
          throw new Error(
            "Документ защищён от редактирования. Снимите защиту в Word и загрузите копию.",
          );
      }
    }
  }
  // Some minimal producers omit the styles relationship but still supply the conventional part.
  if (!styles && entries["word/styles.xml"])
    styles = parseXml(entries["word/styles.xml"], "word/styles.xml");
  return { entries, mainPath, document, body, styles, theme, warnings };
}
