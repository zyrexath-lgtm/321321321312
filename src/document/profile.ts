import type { FormattingProfile } from "./types";

export const DEFAULT_PROFILE: FormattingProfile = Object.freeze({
  fontFamily: "Times New Roman",
  fontSize: 14,
  lineSpacing: 1.5,
  firstLineIndent: 1.25,
  margins: Object.freeze({ left: 3, right: 1.5, top: 2, bottom: 2 }),
  alignment: "both",
});

export function validateProfile(value: unknown): value is FormattingProfile {
  if (!value || typeof value !== "object") return false;
  const p = value as FormattingProfile;
  const between = (n: unknown, min: number, max: number) =>
    typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
  return (
    typeof p.fontFamily === "string" &&
    p.fontFamily.trim().length > 0 &&
    p.fontFamily.length <= 80 &&
    !/[<>\x00-\x1f]/.test(p.fontFamily) &&
    between(p.fontSize, 8, 36) &&
    Number.isInteger(p.fontSize * 2) &&
    between(p.lineSpacing, 1, 3) &&
    between(p.firstLineIndent, 0, 3) &&
    !!p.margins &&
    ["left", "right", "top", "bottom"].every((k) =>
      between(p.margins[k as keyof typeof p.margins], 0.5, 5),
    ) &&
    ["both", "left", "center", "right"].includes(p.alignment)
  );
}

export function assertProfile(profile: FormattingProfile): void {
  if (!validateProfile(profile))
    throw new Error(
      "Проверьте настройки оформления: значения выходят за допустимые пределы.",
    );
}

export const cmToTwips = (cm: number) => Math.round((cm * 1440) / 2.54);
export const twipsToCm = (twips: number) => (twips * 2.54) / 1440;
