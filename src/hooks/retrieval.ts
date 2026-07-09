import * as fs from "node:fs";
import * as path from "node:path";
import { readJSON, writeJSON } from "./shared.js";

// ─── .wolf retrieval index (pure-JS inverted index) ──────────────
// Indexes the three large knowledge files — memory.md, cerebrum.md, buglog.json —
// so consumers can "search then targeted-read" instead of loading whole files.
//
// anatomy.md is intentionally EXCLUDED: it is the full project map that must stay
// fully injected (see docs/planning/10_openwolf-context-optimization §4 rule 6).
// The IndexedFile type below has no "anatomy" member — this is a compile-time guard.

export type IndexedFile = "memory" | "cerebrum" | "buglog";

export interface WolfRecord {
  file: IndexedFile;
  line: number;
  locator: string; // "L<n>" for prose, bug id for buglog
  section: string;
  snippet: string;
}

interface WolfIndex {
  version: number;
  built_at: string;
  records: WolfRecord[];
  postings: Record<string, number[]>;
}

interface BuildItem {
  rec: WolfRecord;
  text: string;
}

const INDEX_VERSION = 1;

function indexPath(wolfDir: string): string {
  return path.join(wolfDir, "index", "wolf-index.json");
}

function cap(s: string, n: number): string {
  const t = s.trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

// Tokenizer: ASCII word runs + single CJK chars + CJK bigrams (cheap CJK recall
// without a segmenter). Used identically at index and query time.
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const lower = text.toLowerCase();
  for (const m of lower.matchAll(/[a-z0-9_]{2,}/g)) out.push(m[0]);
  for (const run of lower.match(/[一-鿿]+/g) ?? []) {
    for (let i = 0; i < run.length; i++) {
      out.push(run[i]);
      if (i + 1 < run.length) out.push(run.slice(i, i + 2));
    }
  }
  return [...new Set(out)];
}

function collectLineFile(items: BuildItem[], filePath: string, file: IndexedFile): void {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return;
  }
  const lines = content.split("\n");
  let section = "";
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const h = t.match(/^#{1,6}\s+(.*)/);
    if (h) {
      section = h[1].trim();
      continue;
    }
    if (!t) continue;
    if (/^\|?[-\s|:]+\|?$/.test(t)) continue; // markdown table separator row
    if (t.startsWith("> Consolidated session")) continue;
    items.push({
      rec: { file, line: i + 1, locator: `L${i + 1}`, section, snippet: cap(t, 160) },
      text: t,
    });
  }
}

function collectBuglog(items: BuildItem[], filePath: string): void {
  const log = readJSON<{ bugs?: Array<Record<string, any>> }>(filePath, { bugs: [] });
  if (!Array.isArray(log.bugs)) return;
  log.bugs.forEach((b, idx) => {
    const tags: string[] = Array.isArray(b.tags) ? b.tags : [];
    const text = [b.error_message, b.root_cause, b.fix, tags.join(" ")]
      .filter(Boolean)
      .join(" ");
    items.push({
      rec: {
        file: "buglog",
        line: idx + 1,
        locator: typeof b.id === "string" ? b.id : `#${idx + 1}`,
        section: tags.join(","),
        snippet: cap(String(b.error_message || text), 160),
      },
      text,
    });
  });
}

/** Rebuild the .wolf/index from memory.md, cerebrum.md and buglog.json. */
export function buildIndex(wolfDir: string): void {
  const items: BuildItem[] = [];
  collectLineFile(items, path.join(wolfDir, "memory.md"), "memory");
  collectLineFile(items, path.join(wolfDir, "cerebrum.md"), "cerebrum");
  collectBuglog(items, path.join(wolfDir, "buglog.json"));

  const records: WolfRecord[] = items.map((it) => it.rec);
  const postings: Record<string, number[]> = {};
  items.forEach((it, id) => {
    for (const tok of tokenize(it.text)) {
      (postings[tok] ??= []).push(id);
    }
  });

  const idx: WolfIndex = {
    version: INDEX_VERSION,
    built_at: new Date().toISOString(),
    records,
    postings,
  };
  writeJSON(indexPath(wolfDir), idx);
}

export interface SearchHit extends WolfRecord {
  score: number;
}

export interface SearchOpts {
  file?: IndexedFile;
  topK?: number;
}

/**
 * Search the prebuilt index. Reads only .wolf/index/wolf-index.json — never the
 * source knowledge files. Returns locating hits (file + line + snippet).
 */
export function search(wolfDir: string, query: string, opts: SearchOpts = {}): SearchHit[] {
  const idx = readJSON<WolfIndex>(indexPath(wolfDir), {
    version: INDEX_VERSION,
    built_at: "",
    records: [],
    postings: {},
  });
  const qtokens = tokenize(query);
  const scores = new Map<number, number>();
  for (const tok of qtokens) {
    const ids = idx.postings[tok];
    if (!ids) continue;
    for (const id of ids) scores.set(id, (scores.get(id) ?? 0) + 1);
  }
  let hits: SearchHit[] = [];
  for (const [id, score] of scores) {
    const rec = idx.records[id];
    if (!rec) continue;
    if (opts.file && rec.file !== opts.file) continue;
    hits.push({ ...rec, score });
  }
  hits.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line);
  return hits.slice(0, opts.topK ?? 10);
}

/** True if an index file exists for this project. */
export function indexExists(wolfDir: string): boolean {
  return fs.existsSync(indexPath(wolfDir));
}
