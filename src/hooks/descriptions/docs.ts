// Phase-1 doc / first-line extraction — runs before structured phase-2 logic.
// Returns the first matched description, or null to fall through to phase-2.
// Extracted from extractDescription (OPT-33 step 4).
import { capDescription as cap } from "./cap.js";

export function extractDocComment(content: string, ext: string): string | null {
  // Markdown heading
  if (ext === ".md" || ext === ".mdx") {
    const m = content.match(/^#{1,2}\s+(.+)$/m);
    if (m) return cap(m[1].trim());
  }

  // HTML title
  if (ext === ".html" || ext === ".htm") {
    const m = content.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (m) return cap(m[1].trim());
  }

  // JSDoc / PHPDoc / Javadoc — first meaningful line
  const jm = content.match(/\/\*\*\s*\n?\s*\*?\s*(.+)/);
  if (jm) {
    const l = jm[1].replace(/\*\/$/, "").trim();
    if (l && !l.startsWith("@") && l.length > 5) return cap(l);
  }

  // Python docstring
  if (ext === ".py") {
    const dm = content.match(/^(?:#[^\n]*\n)*\s*(?:"""(.+?)"""|'''(.+?)''')/s);
    if (dm) {
      const first = (dm[1] || dm[2]).split("\n")[0].trim();
      if (first && first.length > 3) return cap(first);
    }
  }

  // Rust doc comments
  if (ext === ".rs") {
    const lines = content.split("\n");
    for (const line of lines.slice(0, 20)) {
      const m = line.match(/^\s*(?:\/\/\/|\/\/!)\s*(.+)/);
      if (m && m[1].length > 5) return cap(m[1].trim());
    }
  }

  // Go package comment
  if (ext === ".go") {
    const m = content.match(/\/\/\s*Package\s+\w+\s+(.*)/);
    if (m) return cap(m[1].trim());
  }

  // C# XML doc
  if (ext === ".cs") {
    const m = content.match(/<summary>\s*([\s\S]*?)\s*<\/summary>/);
    if (m) {
      const text = m[1].replace(/\/\/\/\s*/g, "").replace(/\s+/g, " ").trim();
      if (text.length > 5) return cap(text);
    }
  }

  // Elixir @moduledoc
  if (ext === ".ex" || ext === ".exs") {
    const m = content.match(/@moduledoc\s+"""\s*\n\s*(.*)/);
    if (m) return cap(m[1].trim());
  }

  // Header comment (skip generic ones)
  const hdrLines = content.split("\n");
  for (const line of hdrLines.slice(0, 15)) {
    const t = line.trim();
    if (!t || t === "<?php" || t.startsWith("#!") || t.startsWith("namespace") || t.startsWith("use ") || t.startsWith("import ") || t.startsWith("from ") || t.startsWith("require") || t.startsWith("module ")) continue;
    const cm = t.match(/^(?:\/\/|#|--)\s*(.+)/);
    if (cm) {
      const text = cm[1].trim();
      const lower = text.toLowerCase();
      if (text.length > 5 && !lower.startsWith("copyright") && !lower.startsWith("license") && !lower.startsWith("@") && !lower.startsWith("strict") && !lower.startsWith("generated") && !lower.startsWith("eslint-") && !lower.startsWith("nolint")) {
        return cap(text);
      }
    }
    if (!t.startsWith("//") && !t.startsWith("#") && !t.startsWith("/*") && !t.startsWith("*") && !t.startsWith("--")) break;
  }
  return null;
}
