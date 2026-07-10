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

// English stopwords filtered from ASCII tokens so high-frequency filler words
// (the/a/is/of/...) don't bloat the index or dominate search (OPT-15). Applied
// identically at index and query time (tokenize is shared), so index/query
// tokenization stays consistent (cf. OPT-25). CJK tokens are never filtered —
// Chinese has no equivalent stopword list and filtering CJK chars would harm
// recall.
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "else", "then", "of", "in", "on",
  "at", "to", "for", "with", "by", "as", "is", "are", "was", "were", "be", "been",
  "being", "am", "do", "does", "did", "has", "have", "had", "will", "would",
  "can", "could", "should", "shall", "may", "might", "this", "that", "these",
  "those", "it", "its", "from", "into", "not", "no", "so", "than", "too", "very",
]);

// Tokenizer: ASCII word runs + single CJK chars + CJK bigrams (cheap CJK recall
// without a segmenter). Used identically at index and query time.
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const lower = text.toLowerCase();
  for (const m of lower.matchAll(/[a-z0-9_]{2,}/g)) {
    if (!STOPWORDS.has(m[0])) out.push(m[0]);
  }
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

// Newest mtime of the three indexed source files; Infinity if any is missing
// (a missing source forces a rebuild so its absence is reflected).
function newestSourceMtime(wolfDir: string): number {
  let newest = 0;
  for (const f of ["memory.md", "cerebrum.md", "buglog.json"]) {
    try {
      const m = fs.statSync(path.join(wolfDir, f)).mtimeMs;
      if (m > newest) newest = m;
    } catch {
      return Infinity;
    }
  }
  return newest;
}

/** Rebuild the .wolf/index from memory.md, cerebrum.md and buglog.json.
 *  Skips the rebuild (returns false) when the index is fresh — it exists AND
 *  was built at or after the newest source mtime — so the Stop hook doesn't
 *  redo O(n) I/O every session when nothing changed (OPT-16). Returns true if
 *  it rebuilt, false if it skipped. */
export function buildIndex(wolfDir: string): boolean {
  const idxPath = indexPath(wolfDir);
  try {
    const existing = readJSON<WolfIndex>(idxPath, { version: 0, built_at: "", records: [], postings: {} });
    if (existing.built_at) {
      const builtMs = Date.parse(existing.built_at);
      if (Number.isFinite(builtMs) && builtMs >= newestSourceMtime(wolfDir)) {
        return false; // fresh — skip rebuild
      }
    }
  } catch {
    // no/invalid index → fall through and build
  }

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
  writeJSON(idxPath, idx);
  return true;
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
  const N = idx.records.length;
  const scores = new Map<number, number>();
  for (const tok of qtokens) {
    const ids = idx.postings[tok];
    if (!ids || ids.length === 0) continue;
    // BM25-IDF weight: rare terms count more than common filler (OPT-14). The
    // index is binary-presence (postings store record IDs, no per-record term
    // frequency), so this is the IDF component of BM25 with binary TF — full
    // BM25 saturation (k1) + doc-length normalization (b) would need TF +
    // length storage, deferred. Laplace-smoothed: a term in every record
    // (df=N) scores 0 (carries no discriminative info), value always >= 0.
    const idf = Math.log((N + 1) / (ids.length + 1));
    for (const id of ids) scores.set(id, (scores.get(id) ?? 0) + idf);
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
