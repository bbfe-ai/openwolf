// Phase-2 structured descriptions for PHP / Laravel.
// Returns the description string, or null to fall through.
// Extracted from extractDescription (OPT-33 step 3c).
import { capDescription as cap } from "./cap.js";

// .php — Blade / Controller / Model / migration / generic class
export function extractPhp(content: string, basename: string): string | null {
  if (basename.endsWith(".blade.php")) {
    const ext2 = content.match(/@extends\(\s*['"]([^'"]+)['"]\s*\)/);
    const sections = (content.match(/@section\(\s*['"](\w+)['"]/g) || []).map(s => s.match(/['"](\w+)['"]/)?.[1]).filter(Boolean);
    const parts: string[] = [];
    if (ext2) parts.push(`extends ${ext2[1]}`);
    if (sections.length) parts.push(`sections: ${sections.join(", ")}`);
    return cap(parts.length ? `Blade: ${parts.join(", ")}` : "Blade template");
  }

  const classM = content.match(/class\s+(\w+)(?:\s+extends\s+(\w+))?/);
  const className = classM?.[1] || "";
  const parent = classM?.[2] || "";
  const pubMethods = (content.match(/public\s+function\s+(\w+)/g) || [])
    .map(m => m.match(/public\s+function\s+(\w+)/)?.[1])
    .filter(n => n && n !== "__construct" && n !== "middleware") as string[];

  if (basename.endsWith("Controller.php") || parent === "Controller") {
    if (pubMethods.length > 0) {
      const display = pubMethods.slice(0, 5).join(", ");
      return cap(pubMethods.length > 5 ? `${display} + ${pubMethods.length - 5} more` : display);
    }
  }

  if (parent === "Model" || parent === "Authenticatable") {
    const parts: string[] = [];
    const tbl = content.match(/\$table\s*=\s*['"]([^'"]+)['"]/);
    if (tbl) parts.push(`table: ${tbl[1]}`);
    const fill = content.match(/\$fillable\s*=\s*\[([^\]]*)\]/s);
    if (fill) { const c = (fill[1].match(/['"]/g) || []).length / 2; parts.push(`${Math.floor(c)} fields`); }
    const rels = (content.match(/\$this->(hasMany|hasOne|belongsTo|belongsToMany|morphMany|morphTo)\(/g) || []).length;
    if (rels) parts.push(`${rels} rels`);
    return cap(parts.length ? `Model — ${parts.join(", ")}` : `Model: ${className}`);
  }

  if (basename.match(/^\d{4}_\d{2}_\d{2}/)) {
    const create = content.match(/Schema::create\(\s*['"]([^'"]+)['"]/);
    if (create) return `Migration: create ${create[1]} table`;
    const alter = content.match(/Schema::table\(\s*['"]([^'"]+)['"]/);
    if (alter) return `Migration: alter ${alter[1]} table`;
    return "Database migration";
  }

  if (className && pubMethods.length > 0) {
    const display = pubMethods.slice(0, 4).join(", ");
    return cap(pubMethods.length > 4 ? `${className}: ${display} + ${pubMethods.length - 4} more` : `${className}: ${display}`);
  }
  return null;
}
