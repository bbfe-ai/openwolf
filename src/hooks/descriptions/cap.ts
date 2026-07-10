// Description length cap — shared by all per-family description extractors.
// Extracted from extractDescription (OPT-33 seam-first step 2).
export const MAX_DESC = 150;
export function capDescription(s: string): string {
  return s.length <= MAX_DESC ? s : s.slice(0, MAX_DESC - 3) + "...";
}
