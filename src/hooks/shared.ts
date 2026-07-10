import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { KNOWN_DESCRIPTIONS } from "./descriptions/known.js";
import { capDescription as cap } from "./descriptions/cap.js";
import { extractSql, extractProto, extractGraphQL, extractYaml, extractToml, extractElixir, extractLua, extractZig } from "./descriptions/data.js";
import { extractVue, extractCss } from "./descriptions/web.js";
import { extractPython, extractGo, extractRust, extractJava, extractKotlin, extractCSharp, extractRuby, extractSwift, extractDart } from "./descriptions/systems.js";

// Agent adapter seam (initiative 11) — imported here so readNormalizedStdin() can
// detect+normalize cross-agent events in one place, and re-exported so hooks can
// use them directly without repeating the import path.
import { detectAgent, normalizeToolEvent } from "./adapters/normalize.js";
import type { AgentKind, ClaudeShapedEvent } from "./adapters/normalize.js";
export { detectAgent, normalizeToolEvent };
export type { AgentKind, ClaudeShapedEvent };

export function getWolfDir(): string {
  // Prefer CLAUDE_PROJECT_DIR so hooks work even if CWD changes during a session
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return path.join(projectDir, ".wolf");
}

/**
 * Bail out silently if .wolf/ directory doesn't exist in the current project.
 * Call this at the top of every hook to avoid crashes in non-OpenWolf projects.
 */
export function ensureWolfDir(): void {
  const wolfDir = getWolfDir();
  if (!fs.existsSync(wolfDir)) {
    process.exit(0);
  }
}

export interface NormalizedInput {
  agent: AgentKind;
  /** Zero-or-more Claude-shaped events. claude → 1 (passthrough); codex apply_patch
   * → N (one per V4A change); opencode → [] (T3.x). Hooks loop and no-op on empty. */
  events: ClaudeShapedEvent[];
}

/**
 * Read hook stdin ONCE, detect the agent, and normalize into zero-or-more
 * Claude-shaped events. This is the single chokepoint where the agent adapter
 * seam (initiative 11) meets the hook core: hooks call this instead of
 * readStdin()+JSON.parse, then loop `events` running the existing Claude-shaped
 * body. Claude path → 1 event → loop runs once → behavior identical (C1 safe).
 * Reading stdin once here means each hook need not re-implement detect/normalize
 * and must not call readStdin() itself (stdin is consumed exactly once).
 */
export async function readNormalizedStdin(): Promise<NormalizedInput> {
  const raw = await readStdin();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { agent: "claude", events: [] };
  }
  const agent = detectAgent(parsed);
  const events = normalizeToolEvent(agent, parsed);
  return { agent, events };
}

export function readJSON<T = unknown>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJSON(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, filePath);
  } catch {
    // On Windows, rename can fail if another process holds a handle.
    // Fall back to direct write and clean up the tmp file.
    try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8"); } catch {}
    try { fs.unlinkSync(tmp); } catch {}
  }
}

export function readMarkdown(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

export function appendMarkdown(filePath: string, line: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, line, "utf-8");
}

// ─── Config access ───────────────────────────────────────────────
// Reads .wolf/config.json and returns the `openwolf` object. Hooks are
// short-lived processes, so a module-level cache is safe.
let _configCache: Record<string, any> | null = null;
export function readConfig(): Record<string, any> {
  if (_configCache) return _configCache;
  const cfgPath = path.join(getWolfDir(), "config.json");
  const cfg = readJSON<{ openwolf?: Record<string, any> }>(cfgPath, {});
  _configCache = cfg.openwolf ?? {};
  return _configCache;
}

export interface AnatomyEntry {
  file: string;
  description: string;
  tokens: number;
}

export function parseAnatomy(content: string): Map<string, AnatomyEntry[]> {
  const sections = new Map<string, AnatomyEntry[]>();
  let currentSection = "";
  for (const line of content.split("\n")) {
    const sm = line.match(/^## (.+)/);
    if (sm) {
      currentSection = sm[1].trim();
      if (!sections.has(currentSection)) sections.set(currentSection, []);
      continue;
    }
    if (!currentSection) continue;
    const em = line.match(/^- `([^`]+)`(?:\s+—\s+(.+?))?\s*\(~(\d+)\s+tok\)$/);
    if (em) {
      sections.get(currentSection)!.push({
        file: em[1],
        description: em[2] || "",
        tokens: parseInt(em[3], 10),
      });
    }
  }
  return sections;
}

export function serializeAnatomy(
  sections: Map<string, AnatomyEntry[]>,
  metadata: { lastScanned: string; fileCount: number; hits: number; misses: number }
): string {
  const lines: string[] = [
    "# anatomy.md",
    "",
    `> Auto-maintained by OpenWolf. Last scanned: ${metadata.lastScanned}`,
    `> Files: ${metadata.fileCount} tracked | Anatomy hits: ${metadata.hits} | Misses: ${metadata.misses}`,
    "",
  ];
  const keys = [...sections.keys()].sort();
  for (const key of keys) {
    lines.push(`## ${key}`);
    lines.push("");
    const entries = sections.get(key)!.sort((a, b) => a.file.localeCompare(b.file));
    for (const e of entries) {
      const desc = e.description ? ` — ${e.description}` : "";
      lines.push(`- \`${e.file}\`${desc} (~${e.tokens} tok)`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function extractDescription(filePath: string): string {
  const basename = path.basename(filePath);
  const ext = path.extname(basename).toLowerCase();
  if (KNOWN_DESCRIPTIONS[basename]) return KNOWN_DESCRIPTIONS[basename];

  let content: string;
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(12288); // 12KB
    const n = fs.readSync(fd, buf, 0, 12288, 0);
    fs.closeSync(fd);
    content = buf.subarray(0, n).toString("utf-8");
  } catch {
    return "";
  }
  if (!content.trim()) return "";

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

  // ─── PHP / Laravel ───────────────────────────────────────
  if (ext === ".php") {
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
  }

  // ─── TS/JS/React/Next.js ─────────────────────────────────
  if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs") {
    // React component
    if (ext === ".tsx" || ext === ".jsx") {
      const comp = content.match(/(?:export\s+(?:default\s+)?)?(?:function|const)\s+(\w+)/);
      const parts: string[] = [];
      if (comp) parts.push(comp[1]);
      const renders: string[] = [];
      if (/<(?:form|Form)/i.test(content)) renders.push("form");
      if (/<(?:table|Table|DataTable)/i.test(content)) renders.push("table");
      if (/<(?:dialog|Dialog|Modal|Drawer)/i.test(content)) renders.push("modal");
      if (renders.length) parts.push(`renders ${renders.join(", ")}`);
      if (parts.length) return cap(parts.join(" — "));
    }

    // Next.js conventions
    if (basename === "page.tsx" || basename === "page.js") return "Next.js page component";
    if (basename === "layout.tsx" || basename === "layout.js") return "Next.js layout";
    if (basename === "route.ts" || basename === "route.js") {
      const methods = [...new Set((content.match(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/g) || [])
        .map(m => m.match(/(GET|POST|PUT|PATCH|DELETE)/)?.[1]))].filter(Boolean);
      return methods.length ? `Next.js API route: ${methods.join(", ")}` : "Next.js API route";
    }

    // Express/Fastify routes
    const routeHits = content.match(/\.(get|post|put|patch|delete)\s*\(\s*['"`]/g);
    if (routeHits && routeHits.length > 0) {
      const methods = [...new Set(routeHits.map(r => r.match(/\.(get|post|put|patch|delete)/)?.[1]?.toUpperCase()))];
      return cap(`API routes: ${methods.join(", ")} (${routeHits.length} endpoints)`);
    }

    // tRPC router
    if (content.includes("createTRPCRouter") || content.includes("publicProcedure")) {
      const procs = (content.match(/\.(query|mutation|subscription)\s*\(/g) || []).length;
      return procs ? `tRPC router: ${procs} procedures` : "tRPC router";
    }

    // Zod schemas
    if (content.includes("z.object") || content.includes("z.string")) {
      const schemas = (content.match(/(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*z\./g) || [])
        .map(s => s.match(/(?:const|let)\s+(\w+)/)?.[1]).filter(Boolean);
      if (schemas.length) return cap(`Zod schemas: ${schemas.slice(0, 4).join(", ")}${schemas.length > 4 ? ` + ${schemas.length - 4} more` : ""}`);
    }

    // Exports summary
    const exports = (content.match(/export\s+(?:async\s+)?(?:function|class|const|interface|type|enum)\s+(\w+)/g) || [])
      .map(e => e.match(/(\w+)$/)?.[1]).filter(Boolean) as string[];
    if (exports.length > 0 && exports.length <= 5) return `Exports ${exports.join(", ")}`;
    if (exports.length > 5) return cap(`Exports ${exports.slice(0, 4).join(", ")} + ${exports.length - 4} more`);
  }

  // ─── Python / Django / FastAPI / Flask ────────────────────
  if (ext === ".py") { const d = extractPython(content); if (d !== null) return d; }

  // ─── Go ──────────────────────────────────────────────────
  if (ext === ".go") { const d = extractGo(content); if (d !== null) return d; }

  // ─── Rust ────────────────────────────────────────────────
  if (ext === ".rs") { const d = extractRust(content); if (d !== null) return d; }

  // ─── Java / Spring ───────────────────────────────────────
  if (ext === ".java") { const d = extractJava(content, basename); if (d !== null) return d; }

  // ─── Kotlin ──────────────────────────────────────────────
  if (ext === ".kt" || ext === ".kts") { const d = extractKotlin(content, basename); if (d !== null) return d; }

  // ─── C# / .NET ───────────────────────────────────────────
  if (ext === ".cs") { const d = extractCSharp(content, basename); if (d !== null) return d; }

  // ─── Ruby / Rails ────────────────────────────────────────
  if (ext === ".rb") { const d = extractRuby(content, basename); if (d !== null) return d; }

  // ─── Swift ───────────────────────────────────────────────
  if (ext === ".swift") { const d = extractSwift(content); if (d !== null) return d; }

  // ─── Dart / Flutter ──────────────────────────────────────
  if (ext === ".dart") { const d = extractDart(content); if (d !== null) return d; }

  // ─── Vue / Svelte / Astro ────────────────────────────────
  if (ext === ".vue") { const d = extractVue(content); if (d !== null) return d; }
  if (ext === ".svelte") return `Svelte: ${basename.replace(".svelte", "")}`;
  if (ext === ".astro") return `Astro: ${basename.replace(".astro", "")}`;

  // ─── CSS / SCSS / Less ───────────────────────────────────
  if (ext === ".css" || ext === ".scss" || ext === ".less") { const d = extractCss(content); if (d !== null) return d; }

  // ─── SQL ─────────────────────────────────────────────────
  if (ext === ".sql") { const d = extractSql(content); if (d !== null) return d; }

  // ─── Proto / GraphQL ─────────────────────────────────────
  if (ext === ".proto") { const d = extractProto(content); if (d !== null) return d; }
  if (ext === ".graphql" || ext === ".gql") { const d = extractGraphQL(content); if (d !== null) return d; }

  // ─── YAML ────────────────────────────────────────────────
  if (ext === ".yaml" || ext === ".yml") { const d = extractYaml(content, basename); if (d !== null) return d; }

  // ─── TOML ────────────────────────────────────────────────
  if (ext === ".toml") { const d = extractToml(content); if (d !== null) return d; }

  // ─── Elixir (phase 2) ────────────────────────────────────
  if (ext === ".ex" || ext === ".exs") { const d = extractElixir(content); if (d !== null) return d; }

  // ─── Lua ─────────────────────────────────────────────────
  if (ext === ".lua") { const d = extractLua(content); if (d !== null) return d; }

  // ─── Zig ─────────────────────────────────────────────────
  if (ext === ".zig") { const d = extractZig(content); if (d !== null) return d; }

  // Last resort
  const declM = content.match(/(?:function|class|const|interface|type|enum)\s+(\w+)/);
  if (declM) {
    const name = declM[1];
    const methods = (content.match(/(?:public\s+)?(?:async\s+)?(?:function\s+|(?:get|set)\s+)(\w+)\s*\(/g) || [])
      .map(m => m.match(/(\w+)\s*\(/)?.[1]).filter(n => n && n !== name && n !== "__construct" && n !== "constructor") as string[];
    if (methods.length > 0 && methods.length <= 5) return cap(`${name}: ${methods.join(", ")}`);
    if (methods.length > 5) return cap(`${name}: ${methods.slice(0, 3).join(", ")} + ${methods.length - 3} more`);
    return `Declares ${name}`;
  }
  return "";
}

export function estimateTokens(text: string, type: "code" | "prose" | "mixed" = "mixed"): number {
  // OPT-29: chars_per_token_{code,prose} are configurable (default 3.5 / 4.0);
  // mixed uses the average of the two. readConfig is cached per-process.
  const ta = readConfig().token_audit ?? {};
  const codeRatio = typeof ta.chars_per_token_code === "number" ? ta.chars_per_token_code : 3.5;
  const proseRatio = typeof ta.chars_per_token_prose === "number" ? ta.chars_per_token_prose : 4.0;
  const ratio = type === "code" ? codeRatio : type === "prose" ? proseRatio : (codeRatio + proseRatio) / 2;
  return Math.ceil(text.length / ratio);
}

export function timestamp(): string {
  return new Date().toISOString();
}

export function timeShort(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk as Buffer));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    // If no stdin data after 4s, resolve with whatever we have so far.
    // On Windows, stdin delivery from Claude Code hooks can be slow.
    setTimeout(() => resolve(chunks.length ? Buffer.concat(chunks).toString("utf-8") : "{}"), 4000);
  });
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}
