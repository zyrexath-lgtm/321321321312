import { strToU8, zipSync } from "fflate";

/** A genuine, deliberately misformatted DOCX generated locally; no network request. */
export function createSampleDocument(): Uint8Array {
  const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const paragraphs = [
    "Современные технологии в образовательной среде",
    "Цифровые инструменты помогают студентам сосредоточиться на содержании работы. При этом единообразное оформление делает текст понятным и удобным для чтения.",
    "Цель этой работы — исследовать, как технологии меняют обучение. Для этого рассматриваются доступность знаний, самостоятельная работа и взаимодействие студентов с преподавателем.",
    "Хороший инструмент работает незаметно: сохраняет авторский текст, объясняет каждое изменение и оставляет человеку контроль над результатом.",
    "Оформление учебной работы",
    "Размер шрифта, интервалы и поля формируют общий ритм страницы. Их можно привести к требованиям, не затрагивая саму мысль автора.",
  ];
  const body = paragraphs
    .map((text, i) =>
      i === 0 || i === 4
        ? `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
        : `<w:p><w:pPr><w:spacing w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="24"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`,
    )
    .join("");
  const files: Record<string, string> = {
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/_rels/document.xml.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${w}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
    "word/styles.xml": `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="${w}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>`,
  };
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([path, xml]) => [path, strToU8(xml)]),
    ),
    { level: 6 },
  );
}
