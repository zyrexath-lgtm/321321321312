import { DEFAULT_PROFILE, validateProfile } from "../document/profile";
import type { FormattingProfile } from "../document/types";

export type HistoryEntry = {
  name: string;
  date: number;
  score: number;
  issues: number;
};
export const PROFILE_KEY = "norma.profile.v1";
export const HISTORY_KEY = "norma.history.v1";

// Storage is untrusted and optional. Bound parsing and validate persisted metadata
// so stale or manually edited values cannot break the document workspace.
export function loadProfile(): FormattingProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw && raw.length <= 4096) {
      const profile: unknown = JSON.parse(raw);
      if (validateProfile(profile)) return profile;
    }
  } catch {
    /* Storage may be unavailable. */
  }
  return structuredClone(DEFAULT_PROFILE);
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw || raw.length > 32 * 1024) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter((entry): entry is HistoryEntry => {
        if (!entry || typeof entry !== "object") return false;
        const { name, date, score, issues } = entry;
        return (
          typeof name === "string" &&
          name.length > 0 &&
          name.length <= 512 &&
          typeof date === "number" &&
          Number.isFinite(date) &&
          date >= 0 &&
          date <= Date.now() + 86400000 &&
          typeof score === "number" &&
          Number.isInteger(score) &&
          score >= 0 &&
          score <= 100 &&
          typeof issues === "number" &&
          Number.isSafeInteger(issues) &&
          issues >= 0
        );
      })
      .slice(0, 5);
  } catch {
    return [];
  }
}

export function storeProfile(profile: FormattingProfile): boolean {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
}

export function storeHistory(history: HistoryEntry[]): void {
  try {
    if (history.length)
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    else localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* A disabled or full store must never prevent document processing. */
  }
}
