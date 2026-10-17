# Adversarial DOCX corpus

`academic.ts` generates synthetic, non-personal OPC packages with real PNG media
and an embedded XLSX. The main document includes three sections with portrait /
landscape / portrait pages, different initial margins, first/default/even headers,
page-number fields, TOC fields across paragraphs, bookmarks, hyperlinks,
footnotes/endnotes, comments, nested numbering, merged/nested tables, inline and
floating images, Office Math, captions, revisions, inherited paragraph/character
styles, split runs, superscripts/subscripts, Unicode, NBSP, soft hyphens, and empty
paragraphs. A separate fixture exercises 6,000 paragraphs / 12,000 runs.

Run `npx vitest run tests/corpus.test.ts`. The tests check:

- original → analyse → fix → save → reopen → analyse;
- actual direct XML values for every supported correction;
- exact text-node preservation, including deleted/field/Math text;
- exact bytes for every ZIP part except the main document;
- a document-wide semantic diff that permits only supported formatting edits;
- unchanged protected paragraphs, media, relationships and complex subtrees;
- byte-for-byte idempotence after reopening;
- independently resolved internal relationships and XML `r:id` references.

Original/fixed corpus files are written to `/tmp/norma-hardening/corpus` (override
with `NORMA_CORPUS_DIR`). To verify them independently of the JavaScript parser:

```bash
python3 tests/compatibility/check.py
python3 tests/compatibility/check.py --libreoffice
```

The Python script uses standard-library `zipfile` CRC checks and ElementTree to
parse every XML part, resolves relationships, and compares all untouched parts
and text. If installed, `python-docx` also opens both packages. `--libreoffice`
additionally opens, resaves a copy, exports PDF, checks PDF pages/text, and
independently validates the resaved package. Reports and conversions remain in
the temporary corpus directory; no source document is overwritten.

These are separate claims: structural validity, LibreOffice compatibility, and
Microsoft Word compatibility. Microsoft Word is not run by this test suite;
neither correct structure nor LibreOffice rendering certifies Word layout.
