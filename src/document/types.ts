export type CategoryId =
  | "page"
  | "text"
  | "paragraphs"
  | "headings"
  | "tables"
  | "images"
  | "numbering"
  | "references";

/** Sizes are points; distances are centimetres; lineSpacing is a multiple. */
export interface FormattingProfile {
  fontFamily: string;
  fontSize: number;
  lineSpacing: number;
  firstLineIndent: number;
  margins: { left: number; right: number; top: number; bottom: number };
  alignment: "both" | "left" | "center" | "right";
}

export interface Issue {
  id: string;
  category: CategoryId;
  title: string;
  description: string;
  found: string;
  expected: string;
  count: number;
  fixable: boolean;
  severity: "warning" | "info";
  ruleId: string;
}

export interface AnalysisReport {
  score: number;
  issues: Issue[];
  stats: {
    paragraphs: number;
    words: number;
    tables: number;
    images: number;
    sections: number;
  };
  excerpt: string;
  checkedRules: number;
  warnings: string[];
}

export interface FixResult {
  bytes: Uint8Array;
  report: AnalysisReport;
  fixedCount: number;
}
