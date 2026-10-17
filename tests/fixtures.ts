import { strToU8, zipSync, type Zippable } from "fflate";

export const W_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const R_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// A tiny actual 1×1 PNG, rather than an invalid placeholder media payload.
const png = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0,
  0, 0, 1, 8, 4, 0, 0, 0, 181, 28, 12, 2, 0, 0, 0, 11, 73, 68, 65, 84, 120, 218,
  99, 100, 248, 15, 0, 1, 5, 1, 1, 39, 24, 227, 102, 0, 0, 0, 0, 73, 69, 78, 68,
  174, 66, 96, 130,
]);

const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const contentTypes = `${declaration}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

export const badParagraph = `<w:p w:rsidR="00112233"><w:pPr><w:spacing w:before="40" w:after="80" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:t xml:space="preserve">Учебная работа: проверяем текст,  формулы и оформление. </w:t></w:r></w:p>`;
const inheritedParagraph = `<w:p><w:pPr><w:pStyle w:val="BodyText"/></w:pPr><w:r><w:t>Этот абзац наследует оформление из стиля.</w:t></w:r></w:p>`;
const styles = `${declaration}<w:styles xmlns:w="${W_NS}">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="left"/></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:line="240"/><w:ind w:firstLine="0"/><w:jc w:val="left"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
</w:styles>`;

const pageProperties = `<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="708" w:footer="708" w:gutter="0"/>`;

const richContent = `
  <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Глава 1. Сохранность документа</w:t></w:r></w:p>
  <w:p><w:bookmarkStart w:id="0" w:name="chapter"/><w:r><w:t>Ссылка: </w:t></w:r><w:hyperlink r:id="rIdHyperlink"><w:r><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr><w:t>источник</w:t></w:r></w:hyperlink><w:bookmarkEnd w:id="0"/><w:r><w:footnoteReference w:id="2"/></w:r></w:p>
  <w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="2500"/><w:gridCol w:w="2500"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="2500" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Ячейка A1</w:t></w:r></w:p><w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Вложенная таблица</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/></w:tc><w:tc><w:p><w:r><w:t>Ячейка B1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  <w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Preserved PNG" descr="Regression image"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
  <w:p><m:oMath><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath></w:p>
  <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Элемент нумерованного списка</w:t></w:r></w:p>
  <w:p><w:pPr><w:sectPr><w:type w:val="nextPage"/>${pageProperties}</w:sectPr></w:pPr><w:r><w:t>Конец первого раздела</w:t></w:r></w:p>
`;

export function documentXml({ rich = true }: { rich?: boolean } = {}): string {
  return `${declaration}<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>${badParagraph}${inheritedParagraph}${rich ? richContent : ""}<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/>${pageProperties}</w:sectPr></w:body></w:document>`;
}

export function fixtureEntries(
  options: { rich?: boolean; document?: string; styles?: string } = {},
): Record<string, Uint8Array> {
  const entries: Record<string, string | Uint8Array> = {
    "[Content_Types].xml": contentTypes,
    "_rels/.rels": `${declaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    "word/document.xml": options.document ?? documentXml(options),
    "word/styles.xml": options.styles ?? styles,
    "word/_rels/document.xml.rels": `${declaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/><Relationship Id="rIdHyperlink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.org/reference" TargetMode="External"/><Relationship Id="rIdFootnotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/><Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`,
    "word/numbering.xml": `${declaration}<w:numbering xmlns:w="${W_NS}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
    "word/footnotes.xml": `${declaration}<w:footnotes xmlns:w="${W_NS}"><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote><w:footnote w:id="2"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>Текст сноски, который нельзя потерять.</w:t></w:r></w:p></w:footnote></w:footnotes>`,
    "word/header1.xml": `${declaration}<w:hdr xmlns:w="${W_NS}"><w:p><w:r><w:t>Верхний колонтитул</w:t></w:r></w:p></w:hdr>`,
    "word/footer1.xml": `${declaration}<w:ftr xmlns:w="${W_NS}"><w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`,
    "word/media/image1.png": png,
    "docProps/core.xml": `${declaration}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Регрессионный DOCX</dc:title><dc:creator>Тестовый студент</dc:creator></cp:coreProperties>`,
    "customXml/item1.xml": `${declaration}<student xmlns="urn:preservation-test"><value>Preserve this unknown XML exactly</value></student>`,
  };
  return Object.fromEntries(
    Object.entries(entries).map(([name, value]) => [
      name,
      typeof value === "string" ? strToU8(value) : value.slice(),
    ]),
  );
}

export function createFixture(
  options: Parameters<typeof fixtureEntries>[0] = {},
): Uint8Array {
  return zipSync(fixtureEntries(options) as Zippable, { level: 6 });
}
