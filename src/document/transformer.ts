import type { FormattingProfile } from "./types";
import type { ParsedDocument } from "./parser";
import type { RuleMatch } from "./rules";
import { cmToTwips } from "./profile";
import { attr, ensureChild, removeAttr, setAttr } from "./xml";

/** Surgical property edits; no paragraph/run replacement or style rewrites. */
export function applyRule(
  parsed: ParsedDocument,
  match: RuleMatch,
  profile: FormattingProfile,
): void {
  switch (match.issue.ruleId) {
    case "page.margins": {
      const sections = [...(match.sections ?? [])];
      if (match.impliedSection)
        sections.push(ensureChild(parsed.body, "sectPr"));
      for (const section of sections) {
        const margins = ensureChild(section, "pgMar");
        for (const side of ["left", "right", "top", "bottom"] as const)
          setAttr(margins, side, cmToTwips(profile.margins[side]));
        for (const [name, value] of [
          ["header", 720],
          ["footer", 720],
          ["gutter", 0],
        ] as const)
          if (attr(margins, name) === undefined) setAttr(margins, name, value);
      }
      break;
    }
    case "text.font":
      for (const run of match.runs ?? []) {
        const fonts = ensureChild(ensureChild(run, "rPr"), "rFonts");
        setAttr(fonts, "ascii", profile.fontFamily);
        setAttr(fonts, "hAnsi", profile.fontFamily);
        removeAttr(fonts, "asciiTheme");
        removeAttr(fonts, "hAnsiTheme");
      }
      break;
    case "text.size":
      for (const run of match.runs ?? [])
        setAttr(
          ensureChild(ensureChild(run, "rPr"), "sz"),
          "val",
          Math.round(profile.fontSize * 2),
        );
      break;
    case "paragraph.spacing":
      for (const p of match.paragraphs ?? []) {
        const spacing = ensureChild(ensureChild(p, "pPr"), "spacing");
        setAttr(spacing, "line", Math.round(profile.lineSpacing * 240));
        setAttr(spacing, "lineRule", "auto");
      }
      break;
    case "paragraph.indent":
      for (const p of match.paragraphs ?? []) {
        const indent = ensureChild(ensureChild(p, "pPr"), "ind");
        for (const name of ["hanging", "hangingChars", "firstLineChars"])
          removeAttr(indent, name);
        setAttr(indent, "firstLine", cmToTwips(profile.firstLineIndent));
      }
      break;
    case "paragraph.alignment":
      for (const p of match.paragraphs ?? [])
        setAttr(
          ensureChild(ensureChild(p, "pPr"), "jc"),
          "val",
          profile.alignment,
        );
      break;
  }
}
