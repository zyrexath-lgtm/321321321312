import { Inflate, strFromU8 } from "fflate";
import {
  parseXml,
  inspectXml,
  isWord,
  child,
  descendants,
  type XmlDocument,
  type XmlElement,
} from "./xml";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 100 * 1024 * 1024;
const OFFICE_REL =
  /^http:\/\/(?:schemas\.openxmlformats\.org\/officeDocument\/2006|purl\.oclc\.org\/ooxml\/officeDocument)\/relationships\/officeDocument$/;
const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";

function decodeZipName(bytes: Uint8Array, utf8: boolean): string {
  try {
    return utf8
      ? new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
      : strFromU8(bytes, true);
  } catch {
    throw new Error(
      "Повреждена кодировка имён внутри ZIP. Пересохраните документ.",
    );
  }
}

interface EntryMeta {
  name: string;
  size: number;
  compressedSize: number;
  crc: number;
  dataAt: number;
  method: number;
  localAt: number;
  recordEnd: number;
}
export interface ParsedDocument {
  entries: Record<string, Uint8Array>;
  mainPath: string;
  document: XmlDocument;
  body: XmlElement;
  styles?: XmlDocument;
  theme?: XmlDocument;
  warnings: string[];
  alreadyCompressedParts?: Set<string>;
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
    const name = decodeZipName(
      bytes.subarray(at + 46, at + 46 + nameLen),
      !!(flags & 2048),
    );
    if (flags & 1 || flags & 64)
      throw new Error(
        "Документы с паролем не поддерживаются. Снимите защиту и загрузите копию.",
      );
    if (flags & ~(2 | 4 | 8 | 2048) || view.getUint16(at + 34, true) !== 0)
      throw new Error(
        "Неподдерживаемые параметры ZIP внутри DOCX. Сохраните обычную копию документа.",
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
      /[\u0000-\u001F?#]/.test(name) ||
      /^[a-z][a-z\d+.-]*:/i.test(name) ||
      name
        .split("/")
        .some(
          (part, index, parts) =>
            part === ".." ||
            part === "." ||
            (!part && index < parts.length - 1),
        ) ||
      /%(?![0-9a-f]{2})|%(?:2e|2f|5c|00)/i.test(name) ||
      names.has(partKey(name))
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
    const localName = decodeZipName(
      bytes.subarray(localAt + 30, localAt + 30 + localNameLen),
      !!(flags & 2048),
    );
    if (
      dataAt + compressedSize > centralStart ||
      localName !== name ||
      view.getUint16(localAt + 8, true) !== method ||
      view.getUint16(localAt + 6, true) !== flags
    )
      throw new Error("Несогласованная структура ZIP внутри DOCX.");
    const crc = view.getUint32(at + 16, true);
    const localCrc = view.getUint32(localAt + 14, true),
      localCompressedSize = view.getUint32(localAt + 18, true),
      localSize = view.getUint32(localAt + 22, true);
    let recordEnd = dataAt + compressedSize;
    if (flags & 8) {
      // ZIP writers may include or omit the descriptor's optional signature.
      // Do not interpret a CRC that happens to equal the signature ambiguously.
      const candidates = [recordEnd, recordEnd + 4];
      const descriptor = candidates.find(
        (start) =>
          start + 12 <= centralStart &&
          (start === recordEnd ||
            view.getUint32(recordEnd, true) === 0x08074b50) &&
          view.getUint32(start, true) === crc &&
          view.getUint32(start + 4, true) === compressedSize &&
          view.getUint32(start + 8, true) === size,
      );
      if (
        descriptor === undefined ||
        (localCrc !== 0 && localCrc !== crc) ||
        (localCompressedSize !== 0 && localCompressedSize !== compressedSize) ||
        (localSize !== 0 && localSize !== size)
      )
        throw new Error("Повреждён дескриптор ZIP внутри DOCX.");
      recordEnd = descriptor + 12;
    } else if (
      localCrc !== crc ||
      localCompressedSize !== compressedSize ||
      localSize !== size
    )
      throw new Error(
        "Не совпадают размеры или контрольные суммы ZIP внутри DOCX.",
      );
    if (method === 8 && compressedSize === 0)
      throw new Error("Повреждён поток сжатия ZIP внутри DOCX.");
    names.add(partKey(name));
    entries.push({
      name,
      size,
      compressedSize,
      crc,
      dataAt,
      method,
      localAt,
      recordEnd,
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  if (at !== end) throw new Error("Повреждён каталог ZIP внутри DOCX.");
  const physical = [...entries].sort((a, b) => a.localAt - b.localAt);
  for (let i = 1; i < physical.length; i++)
    if (physical[i].localAt < physical[i - 1].recordEnd)
      throw new Error(
        "Перекрывающиеся записи ZIP внутри DOCX. Обработка остановлена.",
      );
  return { metadata: entries, end };
}

// OPC part names are case-insensitive. Escaped and literal unreserved characters
// must not let two directory records name the same logical part.
function partKey(name: string): string {
  return name
    .replace(/%([0-9a-f]{2})/gi, (_, hex: string) => {
      const c = String.fromCharCode(Number.parseInt(hex, 16));
      return /[a-z\d\-._~]/i.test(c) ? c : `%${hex.toUpperCase()}`;
    })
    .toLowerCase();
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
    target.includes("#") ||
    /[\u0000-\u001F]/.test(target) ||
    target.startsWith("//") ||
    /%(?![0-9a-f]{2})|%(?:2e|2f|5c|00)/i.test(target)
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
    if (node.nodeType !== 1) continue;
    if (
      (node as XmlElement).namespaceURI !== REL_NS ||
      (node as XmlElement).localName !== "Relationship"
    )
      throw new Error("Некорректные связи внутри DOCX.");
    result.push(node as XmlElement);
  }
  return result;
}

function validateRelationships(entries: Record<string, Uint8Array>): {
  root: XmlElement[];
  bySource: Map<string, XmlElement[]>;
  external: boolean;
} {
  const partNames = new Set(Object.keys(entries).map(partKey));
  const bySource = new Map<string, XmlElement[]>();
  let external = false;
  for (const [path, bytes] of Object.entries(entries)) {
    if (!/\.rels$/i.test(path)) continue;
    const match = /^(.*\/)?_rels\/([^/]*)\.rels$/i.exec(path);
    if (!match || (!match[2] && match[1]))
      throw new Error("Неверное расположение связей внутри DOCX.");
    const source = `${match[1] ?? ""}${match[2]}`;
    if (source && !partNames.has(partKey(source)))
      throw new Error("В DOCX отсутствует часть, которой принадлежат связи.");
    const rels = relationships(parseXml(bytes, path));
    const ids = new Set<string>();
    for (const rel of rels) {
      const id = rel.getAttribute("Id") || "";
      const type = rel.getAttribute("Type") || "";
      const target = rel.getAttribute("Target") || "";
      const mode = rel.getAttribute("TargetMode");
      if (
        !id ||
        /[\s:]/u.test(id) ||
        ids.has(id) ||
        !/^[a-z][a-z\d+.-]*:[^\s]+$/i.test(type) ||
        !target ||
        (mode !== null && mode !== "Internal" && mode !== "External")
      )
        throw new Error("Неполные или неоднозначные связи внутри DOCX.");
      ids.add(id);
      if (
        /\/(?:vbaProject(?:Signature)?|vbaData|activeXControl(?:Binary)?|control)(?:$|\/)|\/digital-signature(?:\/|$)/i.test(
          type,
        )
      )
        throw new Error(
          "Макросы, ActiveX и цифровые подписи не поддерживаются. Используйте обычную неподписанную копию DOCX.",
        );
      if (mode === "External") {
        external = true;
        continue; // Never dereference a hyperlink, image, template or other external part.
      }
      // A fragment identifies a subresource in the same package part.
      const resource = target.split("#", 1)[0];
      const resolved = resource ? resolvePart(source, resource) : source;
      if (
        !resolved ||
        !partNames.has(partKey(resolved)) ||
        resolved.endsWith("/")
      )
        throw new Error(
          "В DOCX отсутствует внутренняя часть, указанная в связях. Пересохраните документ.",
        );
    }
    bySource.set(partKey(source), rels);
  }
  const root = bySource.get("");
  if (!root) throw new Error("В DOCX не найдены связи основного документа.");
  return { root, bySource, external };
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
    if (/\.(xml|rels)$/i.test(entry.name)) inspectXml(file, entry.name);
  }
  const entryPaths = new Map(
    Object.keys(entries).map((path) => [partKey(path), path]),
  );
  const findPath = (path: string) => entryPaths.get(partKey(path));
  const typesBytes = entries[findPath("[Content_Types].xml") ?? ""],
    rootRels = entries[findPath("_rels/.rels") ?? ""];
  if (!typesBytes || !rootRels)
    throw new Error(
      "Это ZIP-архив, но не документ DOCX. Выберите файл, сохранённый в Word или LibreOffice.",
    );
  const types = parseXml(typesBytes, "[Content_Types].xml");
  if (
    types.documentElement?.localName !== "Types" ||
    types.documentElement.namespaceURI !== CT_NS
  )
    throw new Error("Неверный формат пакета DOCX.");
  const packageRels = validateRelationships(entries);
  const mainRels = packageRels.root.filter((el) =>
    OFFICE_REL.test(el.getAttribute("Type") || ""),
  );
  if (mainRels.length !== 1)
    throw new Error("В DOCX неоднозначно указан основной документ.");
  const mainRel = mainRels[0];
  if (!mainRel || mainRel.getAttribute("TargetMode") === "External")
    throw new Error("В DOCX не найден основной документ.");
  const mainTarget = resolvePart("", mainRel.getAttribute("Target") || "");
  const mainPath = findPath(mainTarget) ?? mainTarget;
  const typeElements = types.getElementsByTagNameNS(CT_NS, "*");
  let validMainType = false;
  const defaults = new Map<string, string>(),
    overrides = new Map<string, string>();
  for (let i = 0; i < typeElements.length; i++) {
    const el = typeElements.item(i)!;
    const contentType = el.getAttribute("ContentType") || "";
    if (
      /macroEnabled|vbaProject|vbaData|digital-signature|activeX/i.test(
        contentType,
      )
    )
      throw new Error(
        "Макросы, ActiveX и цифровые подписи не поддерживаются. Используйте обычную неподписанную копию DOCX.",
      );
    if (el.localName === "Override") {
      const part = el.getAttribute("PartName") || "";
      if (!part.startsWith("/") || part.endsWith("/"))
        throw new Error("Некорректные типы частей DOCX.");
      const key = partKey(resolvePart("", part));
      if (overrides.has(key))
        throw new Error("Неоднозначные типы частей DOCX.");
      overrides.set(key, contentType);
    }
    if (el.localName === "Default") {
      const extension = (el.getAttribute("Extension") || "").toLowerCase();
      if (!extension || defaults.has(extension))
        throw new Error("Неоднозначные типы частей DOCX.");
      defaults.set(extension, contentType);
    }
    if (
      el.localName === "Override" &&
      partKey(el.getAttribute("PartName") || "") === partKey(`/${mainPath}`) &&
      contentType === DOCX_CONTENT_TYPE
    )
      validMainType = true;
  }
  // XML MIME types need the same safeguards even if a producer uses .bin/.dat.
  for (const [path, bytes] of Object.entries(entries)) {
    if (/\.(xml|rels)$/i.test(path)) continue;
    const contentType =
      overrides.get(partKey(path)) ??
      defaults.get(path.split(".").at(-1)?.toLowerCase() ?? "") ??
      "";
    if (/^(?:application|text)\/xml(?:;|$)|\+xml(?:;|$)/i.test(contentType))
      inspectXml(bytes, path);
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
  if (packageRels.external)
    warnings.push(
      "Внешние ссылки и связанные ресурсы сохранены. Сервис не загружает их и не проверяет их содержимое.",
    );
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
  let styles: XmlDocument | undefined, theme: XmlDocument | undefined;
  const rels = packageRels.bySource.get(partKey(mainPath));
  if (rels) {
    for (const kind of ["styles", "theme", "settings"] as const) {
      const rel = rels.find((r) =>
        (r.getAttribute("Type") || "").endsWith(`/${kind}`),
      );
      if (!rel || rel.getAttribute("TargetMode") === "External") continue;
      const target =
        findPath(resolvePart(mainPath, rel.getAttribute("Target") || "")) ?? "";
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
  const conventionalStyles = findPath("word/styles.xml");
  if (!styles && conventionalStyles)
    styles = parseXml(entries[conventionalStyles], conventionalStyles);
  const alreadyCompressedParts = new Set(
    metadata
      .filter(
        (entry) =>
          /\.(png|jpe?g|gif|webp)$/i.test(entry.name) &&
          (entry.method === 0 ||
            (entry.size > 0 && entry.compressedSize / entry.size >= 0.95)),
      )
      .map((entry) => entry.name),
  );
  return {
    entries,
    mainPath,
    document,
    body,
    styles,
    theme,
    warnings,
    alreadyCompressedParts,
  };
}
