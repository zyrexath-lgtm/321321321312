import { strFromU8, strToU8, zipSync } from "fflate";
import { fixtureEntries, R_NS, W_NS } from "../fixtures";

/** Synthetic, non-personal OPC packages. Every image is real and every internal
 * relationship resolves, so external Office tools can also exercise the corpus. */
export const NS = {
  w: W_NS,
  r: R_NS,
  m: "http://schemas.openxmlformats.org/officeDocument/2006/math",
  wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  pic: "http://schemas.openxmlformats.org/drawingml/2006/picture",
};
export const DECLARATION =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const namespaces = Object.entries(NS)
  .map(([prefix, uri]) => `xmlns:${prefix}="${uri}"`)
  .join(" ");
const text = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const run = (value: string, props = "") =>
  `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${text(value)}</w:t></w:r>`;
const paragraph = (id: string, runs: string, props = "") =>
  `<w:p w:rsidR="${id}">${props ? `<w:pPr>${props}</w:pPr>` : ""}${runs}</w:p>`;
const style = (name: string) => `<w:pStyle w:val="${name}"/>`;

export const PROTECTED_PARAGRAPHS = [
  "00000001",
  "00000003",
  "00000004",
  "00000005",
  "00000006",
  "00000007",
  "00000008",
  "00000009",
  "0000000A",
  "0000000B",
  "0000000C",
  "0000000D",
  "0000000E",
  "0000000F",
  "00000010",
  "00000011",
  "00000012",
  "00000013",
  "00000014",
  "00000015",
  "00000016",
  "00000017",
  "00000018",
];

function picture(id: number, floating: boolean): string {
  const graphic = `<wp:extent cx="457200" cy="457200"/>${floating ? '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/>' : ""}<wp:docPr id="${id}" name="Regression image ${id}" descr="A real PNG"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="${NS.pic}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="457200" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;
  return `<w:r><w:drawing>${floating ? `<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>${graphic}</wp:anchor>` : `<wp:inline distT="0" distB="0" distL="0" distR="0">${graphic}</wp:inline>`}</w:drawing></w:r>`;
}

function section(index: number): string {
  const landscape = index === 2;
  return `<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:headerReference w:type="first" r:id="rIdHeaderFirst"/><w:headerReference w:type="even" r:id="rIdHeaderEven"/><w:footerReference w:type="default" r:id="rIdFooter"/><w:type w:val="nextPage"/><w:pgSz w:w="${landscape ? 16838 : 11906}" w:h="${landscape ? 11906 : 16838}"${landscape ? ' w:orient="landscape"' : ""}/><w:pgMar w:top="${720 + index * 50}" w:right="${720 + index * 90}" w:bottom="${720 + index * 30}" w:left="${720 + index * 110}" w:header="567" w:footer="600" w:gutter="113"/><w:pgNumType w:fmt="${index === 1 ? "lowerRoman" : "decimal"}" w:start="${index === 1 ? 1 : 3}"/><w:cols w:space="720"/><w:titlePg/><w:docGrid w:linePitch="360"/></w:sectPr>`;
}

const table = `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="6000" w:type="dxa"/><w:gridSpan w:val="2"/></w:tcPr><w:p>${run("Объединённая горизонтально ячейка")}</w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/><w:vMerge w:val="restart"/></w:tcPr><w:p>${run("Вертикальное объединение")}</w:p></w:tc><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p>${run("Перед вложенной таблицей")}</w:p><w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p>${run("Вложенная таблица → ①")}</w:p></w:tc></w:tr></w:tbl><w:p/></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p>${run("Последняя ячейка")}</w:p></w:tc></w:tr></w:tbl>`;

export function academicEntries(): Record<string, Uint8Array> {
  const entries = fixtureEntries({ rich: false });
  let types = strFromU8(entries["[Content_Types].xml"]);
  const additionalTypes: Record<string, string> = {
    "word/headerFirst.xml":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml",
    "word/headerEven.xml":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml",
    "word/endnotes.xml":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml",
    "word/comments.xml":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml",
    "word/settings.xml":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml",
    "word/embeddings/worksheet.xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  types = types.replace(
    "</Types>",
    Object.entries(additionalTypes)
      .map(
        ([path, contentType]) =>
          `<Override PartName="/${path}" ContentType="${contentType}"/>`,
      )
      .join("") + "</Types>",
  );
  entries["[Content_Types].xml"] = strToU8(types);
  const relation = (id: string, type: string, target: string) =>
    `<Relationship Id="${id}" Type="${R_NS}/${type}" Target="${target}"/>`;
  entries["word/_rels/document.xml.rels"] = strToU8(
    strFromU8(entries["word/_rels/document.xml.rels"]).replace(
      "</Relationships>",
      [
        relation("rIdHeaderFirst", "header", "headerFirst.xml"),
        relation("rIdHeaderEven", "header", "headerEven.xml"),
        relation("rIdEndnotes", "endnotes", "endnotes.xml"),
        relation("rIdComments", "comments", "comments.xml"),
        relation("rIdSettings", "settings", "settings.xml"),
        relation("rIdEmbedded", "package", "embeddings/worksheet.xlsx"),
      ].join("") + "</Relationships>",
    ),
  );
  entries["word/headerFirst.xml"] = strToU8(
    `${DECLARATION}<w:hdr xmlns:w="${W_NS}"><w:p>${run("Титульный колонтитул")}</w:p></w:hdr>`,
  );
  entries["word/headerEven.xml"] = strToU8(
    `${DECLARATION}<w:hdr xmlns:w="${W_NS}"><w:p>${run("Чётная страница")}</w:p></w:hdr>`,
  );
  entries["word/settings.xml"] = strToU8(
    `${DECLARATION}<w:settings xmlns:w="${W_NS}"><w:evenAndOddHeaders/><w:compat/></w:settings>`,
  );
  entries["word/endnotes.xml"] = strToU8(
    `${DECLARATION}<w:endnotes xmlns:w="${W_NS}"><w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote><w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote><w:endnote w:id="2"><w:p><w:r><w:endnoteRef/></w:r>${run("Концевая сноска: Unicode Ω ≈ 中文")}</w:p></w:endnote></w:endnotes>`,
  );
  entries["word/comments.xml"] = strToU8(
    `${DECLARATION}<w:comments xmlns:w="${W_NS}"><w:comment w:id="0" w:author="Synthetic reviewer" w:initials="QA" w:date="2026-01-01T00:00:00Z"><w:p>${run("Комментарий рецензента, сохранить точно.")}</w:p></w:comment></w:comments>`,
  );
  entries["word/styles.xml"] = strToU8(
    strFromU8(entries["word/styles.xml"]).replace(
      "</w:styles>",
      `
    <w:style w:type="paragraph" w:styleId="BodyDerived"><w:name w:val="Авторский основной текст"/><w:basedOn w:val="BodyText"/></w:style>
    <w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr></w:style>
    <w:style w:type="paragraph" w:styleId="CustomCaption"><w:name w:val="Иллюстративная строка"/><w:basedOn w:val="Caption"/><w:pPr><w:jc w:val="left"/></w:pPr></w:style>
    <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="36"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="CustomHeading"><w:name w:val="Локальное имя раздела"/><w:basedOn w:val="Heading1"/></w:style>
    <w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:b/></w:rPr></w:style>
    <w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/><w:rPr><w:i/></w:rPr></w:style>
    </w:styles>`,
    ),
  );
  entries["word/numbering.xml"] = strToU8(
    `${DECLARATION}<w:numbering xmlns:w="${W_NS}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/>${[0, 1, 2].map((level) => `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="${Array.from({ length: level + 1 }, (_, n) => `%${n + 1}`).join(".")}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (level + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join("")}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
  );
  entries["word/embeddings/worksheet.xlsx"] = embeddedWorkbook();

  const body = [
    paragraph(
      "00000001",
      run("ВЫПУСКНАЯ КВАЛИФИКАЦИОННАЯ РАБОТА"),
      style("Title"),
    ),
    paragraph(
      "00000002",
      run("Основной текст: Cyrillic и Latin; ") +
        run("жирный", '<w:rStyle w:val="Strong"/>') +
        run(" и ") +
        run("курсив", '<w:rStyle w:val="Emphasis"/>') +
        run(
          "; неразрывный\u00a0пробел, мягкий\u00adперенос, 😀, e\u0301, Ω, длинное тире — конец.",
        ),
      style("BodyDerived"),
    ),
    paragraph(
      "00000003",
      run("1. Теоретические основания"),
      style("CustomHeading"),
    ),
    paragraph(
      "00000004",
      '<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>',
    ),
    paragraph(
      "00000005",
      run("1. Теоретические основания\t3") + "<w:r><w:tab/></w:r>" + run("3"),
    ),
    paragraph("00000006", '<w:r><w:fldChar w:fldCharType="end"/></w:r>'),
    paragraph(
      "00000007",
      '<w:fldSimple w:instr=" REF target \\h ">' +
        run("Ссылка на закладку") +
        "</w:fldSimple>",
    ),
    paragraph(
      "00000019",
      '<w:bookmarkStart w:id="7" w:name="target"/>' +
        run("См. ") +
        '<w:hyperlink r:id="rIdHyperlink">' +
        run(
          "исходный источник",
          '<w:color w:val="0563C1"/><w:u w:val="single"/>',
        ) +
        '</w:hyperlink><w:bookmarkEnd w:id="7"/><w:r><w:footnoteReference w:id="2"/></w:r><w:r><w:endnoteReference w:id="2"/></w:r>',
    ),
    ...[0, 1, 2].map((level) =>
      paragraph(
        ["00000008", "00000009", "0000000A"][level],
        run(`Пункт вложенного списка уровня ${level + 1}`),
        `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr>`,
      ),
    ),
    paragraph(
      "0000000B",
      run("Сводные результаты измерений"),
      style("CustomCaption"),
    ),
    table,
    paragraph("0000000C", picture(1, false)),
    paragraph("0000000D", picture(2, true)),
    paragraph("0000000E", run("Рисунок 1 — Пример иллюстрации")),
    paragraph(
      "0000000F",
      "<m:oMath><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup><m:r><m:t> + α = 42</m:t></m:r></m:oMath>",
    ),
    paragraph(
      "00000010",
      run("H") +
        run("2", '<w:sz w:val="20"/><w:vertAlign w:val="subscript"/>') +
        run("O и E=mc") +
        run("2", '<w:sz w:val="18"/><w:vertAlign w:val="superscript"/>') +
        run(" — текстовая формула."),
    ),
    paragraph(
      "00000011",
      '<w:ins w:id="12" w:author="QA" w:date="2026-01-01T00:00:00Z">' +
        run("Добавленный текст") +
        '</w:ins><w:del w:id="13" w:author="QA" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>Удалённый текст</w:delText></w:r></w:del>',
    ),
    paragraph(
      "00000012",
      '<w:moveFrom w:id="14" w:author="QA" w:date="2026-01-01T00:00:00Z">' +
        run("Перенесено из") +
        '</w:moveFrom><w:moveTo w:id="15" w:author="QA" w:date="2026-01-01T00:00:00Z">' +
        run("Перенесено сюда") +
        "</w:moveTo>",
    ),
    paragraph(
      "0000001A",
      '<w:commentRangeStart w:id="0"/>' +
        run("Текст с комментарием.") +
        '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>',
    ),
    paragraph(
      "00000013",
      run("Список использованной литературы"),
      style("Heading1"),
    ),
    paragraph(
      "00000014",
      run("Иванов И. И. Исследование: учебное пособие. — М., 2025. — 300 с."),
    ),
    paragraph(
      "00000015",
      run("Smith J. Unicode and typography. 2024. https://example.org"),
    ),
    paragraph("00000016", run("Приложение А"), style("Heading1")),
    paragraph("00000017", ""),
    paragraph("00000018", '<w:r><w:t xml:space="preserve">   </w:t></w:r>'),
    paragraph("0000001B", run("Конец первого раздела."), section(1)),
    paragraph(
      "0000001C",
      run("Обычный абзац альбомного раздела без потери текста."),
      style("BodyDerived"),
    ),
    paragraph("0000001D", run("Конец альбомного раздела."), section(2)),
    paragraph(
      "0000001E",
      run("Обычный абзац третьего раздела."),
      style("BodyDerived"),
    ),
    section(3),
  ].join("");
  entries["word/document.xml"] = strToU8(
    `${DECLARATION}<w:document ${namespaces}><w:body>${body}</w:body></w:document>`,
  );
  return entries;
}

function embeddedWorkbook(): Uint8Array {
  return zipSync(
    {
      "[Content_Types].xml": strToU8(
        `${DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
      ),
      "_rels/.rels": strToU8(
        `${DECLARATION}<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
      "xl/workbook.xml": strToU8(
        `${DECLARATION}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R_NS}"><sheets><sheet name="Данные" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
      "xl/_rels/workbook.xml.rels": strToU8(
        `${DECLARATION}<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${R_NS}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      ),
      "xl/worksheets/sheet1.xml": strToU8(
        `${DECLARATION}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>42</v></c></row></sheetData></worksheet>`,
      ),
    },
    { level: 6 },
  );
}

export function createAcademicFixture(): Uint8Array {
  return zipSync(academicEntries(), { level: 6 });
}

/** Large text without binary padding: exercises DOM/rule/transformer scale. */
export function createLongTextFixture(paragraphs = 6000): Uint8Array {
  const entries = academicEntries();
  const body = Array.from({ length: paragraphs }, (_, index) =>
    paragraph(
      index.toString(16).padStart(8, "0"),
      run(
        `Абзац ${index}: аналитический текст диплома, несколько символов Ω и неразрывный\u00a0пробел. `,
      ) + run("Выделенная часть.", "<w:b/><w:i/>"),
      style("BodyText"),
    ),
  ).join("");
  entries["word/document.xml"] = strToU8(
    `${DECLARATION}<w:document ${namespaces}><w:body>${body}${section(1)}</w:body></w:document>`,
  );
  return zipSync(entries, { level: 6 });
}
