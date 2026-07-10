// Phase-2 structured descriptions for web-frontend families.
// Each extractor returns the description string, or null to fall through.
// Extracted from extractDescription (OPT-33 step 3b).
import { capDescription as cap } from "./cap.js";

// .vue — component name + setup flag
export function extractVue(content: string): string | null {
  const name = content.match(/name:\s*['"]([^'"]+)['"]/);
  const setup = content.includes("<script setup");
  const parts: string[] = [];
  if (name) parts.push(name[1]);
  if (setup) parts.push("setup");
  return cap(parts.length ? `Vue: ${parts.join(", ")}` : "Vue component");
}

// .css / .scss / .less — rule + var counts
export function extractCss(content: string): string | null {
  const rules = (content.match(/^[.#@][^\n{]+/gm) || []).length;
  const vars = (content.match(/--[\w-]+\s*:/g) || []).length;
  const parts: string[] = [];
  if (rules) parts.push(`${rules} rules`);
  if (vars) parts.push(`${vars} vars`);
  return cap(parts.length ? `Styles: ${parts.join(", ")}` : "Stylesheet");
}
