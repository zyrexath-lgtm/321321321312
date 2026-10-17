import type { Issue } from "../document/types";

export function issueCount(issues: Issue[]) {
  return issues.reduce((sum, issue) => sum + issue.count, 0);
}
export function numberLabel(
  value: number,
  one: string,
  few: string,
  many: string,
) {
  const n = value % 100;
  return n > 10 && n < 20
    ? many
    : value % 10 === 1
      ? one
      : value % 10 >= 2 && value % 10 <= 4
        ? few
        : many;
}
export function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} КБ`
    : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
