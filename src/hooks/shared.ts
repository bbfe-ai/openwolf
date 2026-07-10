import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { KNOWN_DESCRIPTIONS } from "./descriptions/known.js";
import { extractSql, extractProto, extractGraphQL, extractYaml, extractToml, extractElixir, extractLua, extractZig } from "./descriptions/data.js";
import { extractVue, extractCss } from "./descriptions/web.js";
import { extractPython, extractGo, extractRust, extractJava, extractKotlin, extractCSharp, extractRuby, extractSwift, extractDart } from "./descriptions/systems.js";
import { extractPhp } from "./descriptions/php.js";
import { extractTsJs } from "./descriptions/tsjs.js";
import { extractDocComment } from "./descriptions/docs.js";
import { extractFallback } from "./descriptions/fallback.js";

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

  // Phase 1: doc / first-line extraction (markdown heading, HTML title, JSDoc,
  // language docstrings, header comment). Returns null to fall through to phase 2.
  const doc = extractDocComment(content, ext);
  if (doc !== null) return doc;

  // ─── PHP / Laravel ───────────────────────────────────────
  if (ext === ".php") { const d = extractPhp(content, basename); if (d !== null) return d; }

  // ─── TS/JS/React/Next.js ─────────────────────────────────
  if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs") { const d = extractTsJs(content, basename, ext); if (d !== null) return d; }

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
  return extractFallback(content);
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
