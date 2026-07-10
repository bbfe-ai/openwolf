import * as fs from "node:fs";
import * as path from "node:path";
import { readJSON, writeJSON, readConfig } from "./shared.js";

// ─── Memory consolidation ────────────────────────────────────────
// Archives whole sessions from memory.md to .wolf/archive/memory-YYYY-MM.md
// (lossless — full detail preserved). Runs from the Stop hook every session end
// (no daemon required) and, for compatibility, from the cron engine.

function isTableRow(line: string): boolean {
  return line.startsWith("|") && !line.startsWith("|--") && !line.startsWith("| Time");
}

interface SessionBlock {
  date: Date | null;
  lines: string[];
  rows: number;
}

function parseSessions(content: string): { preamble: string[]; blocks: SessionBlock[] } {
  const preamble: string[] = [];
  const blocks: SessionBlock[] = [];
  let cur: SessionBlock | null = null;
  for (const line of content.split("\n")) {
    const m = line.match(/^## Session: (\d{4}-\d{2}-\d{2})/);
    if (m) {
      cur = { date: new Date(m[1]), lines: [line], rows: 0 };
      blocks.push(cur);
      continue;
    }
    if (cur) {
      cur.lines.push(line);
      if (isTableRow(line)) cur.rows++;
    } else {
      preamble.push(line);
    }
  }
  return { preamble, blocks };
}

/**
 * Move memory.md sessions older than `olderThanDays` out to
 * .wolf/archive/memory-YYYY-MM.md with FULL detail preserved (lossless — no
 * folding, nothing dropped). If `maxEntries` is given and the kept sessions'
 * table rows still exceed it, archive the oldest kept sessions too (always
 * keeping the newest session).
 */
export function consolidateMemory(wolfDir: string, olderThanDays: number, maxEntries?: number): void {
  const memoryPath = path.join(wolfDir, "memory.md");
  let content: string;
  try {
    content = fs.readFileSync(memoryPath, "utf-8");
  } catch {
    return;
  }
  if (!content) return;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);

  const { preamble, blocks } = parseSessions(content);
  if (blocks.length === 0) return;

  const archive: SessionBlock[] = [];
  const keep: SessionBlock[] = [];
  for (const b of blocks) {
    if (b.date && b.date < cutoff) archive.push(b);
    else keep.push(b);
  }

  // Count-based safety net: archive oldest kept sessions until under the cap.
  if (maxEntries && maxEntries > 0) {
    const totalRows = () => keep.reduce((s, b) => s + b.rows, 0);
    while (keep.length > 1 && totalRows() > maxEntries) {
      archive.push(keep.shift()!);
    }
  }

  if (archive.length === 0) return;

  // Append archived sessions verbatim to the monthly archive — lossless.
  const archiveDir = path.join(wolfDir, "archive");
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  const archivePath = path.join(archiveDir, `memory-${month}.md`);
  try {
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
    const chunk = archive.map((b) => b.lines.join("\n").replace(/\s+$/, "")).join("\n\n");
    const head = fs.existsSync(archivePath)
      ? "\n\n"
      : `# Memory Archive (${month})\n\n> Full sessions moved out of memory.md by prune. Nothing is lost.\n\n`;
    fs.appendFileSync(archivePath, head + chunk + "\n", "utf-8");
  } catch {
    return; // Never drop detail if archiving failed.
  }

  // Rebuild memory.md = preamble + kept sessions.
  const out = [...preamble, ...keep.flatMap((b) => b.lines)].join("\n");
  const tmp = memoryPath + ".prune.tmp";
  try {
    fs.writeFileSync(tmp, out, "utf-8");
    fs.renameSync(tmp, memoryPath);
  } catch {
    try { fs.writeFileSync(memoryPath, out, "utf-8"); } catch {}
    try { fs.unlinkSync(tmp); } catch {}
  }
}

// ─── Buglog rolling cap ──────────────────────────────────────────

interface BugEntry {
  id: string;
  tags: string[];
  last_seen?: string;
  timestamp?: string;
  [key: string]: unknown;
}
interface BugLog {
  version: number;
  bugs: BugEntry[];
}

function bugTime(b: BugEntry): number {
  return new Date(b.last_seen || b.timestamp || 0).getTime();
}

/**
 * Keep every non-auto-detected bug (real, explicitly-logged bugs) plus the most
 * recent `maxK` auto-detected ones. Overflow auto-detected bugs are archived to
 * .wolf/archive/buglog-YYYYMM.json. Returns the number archived.
 */
export function buglogCap(wolfDir: string, maxK: number): number {
  if (!(maxK > 0)) return 0;
  const bugLogPath = path.join(wolfDir, "buglog.json");
  const bugLog = readJSON<BugLog>(bugLogPath, { version: 1, bugs: [] });
  if (!Array.isArray(bugLog.bugs) || bugLog.bugs.length <= maxK) return 0;

  const isAuto = (b: BugEntry) => Array.isArray(b.tags) && b.tags.includes("auto-detected");
  const real = bugLog.bugs.filter((b) => !isAuto(b));
  const auto = bugLog.bugs.filter(isAuto).sort((a, b) => bugTime(b) - bugTime(a));

  const keptAuto = auto.slice(0, maxK);
  const overflow = auto.slice(maxK);
  if (overflow.length === 0) return 0;

  // Preserve original ordering for the kept set.
  const keptSet = new Set([...real, ...keptAuto]);
  const kept = bugLog.bugs.filter((b) => keptSet.has(b));

  // Archive overflow.
  const archiveDir = path.join(wolfDir, "archive");
  const month = new Date().toISOString().slice(0, 7).replace("-", "");
  const archivePath = path.join(archiveDir, `buglog-${month}.json`);
  try {
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
    const existing = readJSON<BugLog>(archivePath, { version: 1, bugs: [] });
    existing.bugs.push(...overflow);
    writeJSON(archivePath, existing);
  } catch {
    return 0; // Don't drop overflow if archiving failed.
  }

  bugLog.bugs = kept;
  writeJSON(bugLogPath, bugLog);
  return overflow.length;
}

// ─── Token-ledger rolling cap ────────────────────────────────────

interface Ledger {
  version: number;
  sessions: unknown[];
  [key: string]: unknown;
}

/**
 * Keep only the most recent `maxK` entries in token-ledger.json's `sessions[]`;
 * archive the overflow (oldest) verbatim to .wolf/archive/ledger-YYYYMM.json —
 * lossless. `lifetime` totals are cumulative and never touched. Mirrors buglogCap.
 * (OPT-9: token-ledger.json was the fourth bloat file — one push per session,
 * no cap, so it grew linearly with session count.)
 */
export function ledgerCap(wolfDir: string, maxK: number): number {
  if (!(maxK > 0)) return 0;
  const ledgerPath = path.join(wolfDir, "token-ledger.json");
  const ledger = readJSON<Ledger>(ledgerPath, { version: 1, sessions: [] });
  if (!Array.isArray(ledger.sessions) || ledger.sessions.length <= maxK) return 0;

  const overflow = ledger.sessions.slice(0, ledger.sessions.length - maxK);
  const kept = ledger.sessions.slice(ledger.sessions.length - maxK);
  if (overflow.length === 0) return 0;

  const archiveDir = path.join(wolfDir, "archive");
  const month = new Date().toISOString().slice(0, 7).replace("-", "");
  const archivePath = path.join(archiveDir, `ledger-${month}.json`);
  try {
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
    const existing = readJSON<{ version: number; sessions: unknown[] }>(archivePath, { version: 1, sessions: [] });
    existing.sessions.push(...overflow);
    writeJSON(archivePath, existing);
  } catch {
    return 0; // Don't drop overflow if archiving failed.
  }

  ledger.sessions = kept;
  writeJSON(ledgerPath, ledger);
  return overflow.length;
}

// ─── Combined entry point for the Stop hook ──────────────────────

/** Run all write-path governance using values from .wolf/config.json. */
export function runPrune(wolfDir: string): void {
  const mem = readConfig().memory ?? {};
  const bug = readConfig().buglog ?? {};
  const led = readConfig().ledger ?? {};
  const olderThanDays = typeof mem.consolidation_after_days === "number" ? mem.consolidation_after_days : 7;
  const maxEntries = typeof mem.max_entries_before_consolidation === "number" ? mem.max_entries_before_consolidation : 200;
  const bugMax = typeof bug.max_entries === "number" ? bug.max_entries : 200;
  const ledgerMax = typeof led.max_sessions === "number" ? led.max_sessions : 200;
  try { consolidateMemory(wolfDir, olderThanDays, maxEntries); } catch {}
  try { buglogCap(wolfDir, bugMax); } catch {}
  try { ledgerCap(wolfDir, ledgerMax); } catch {}
}

// ─── Cerebrum backup-before-overwrite ────────────────────────────

/**
 * Back up the existing cerebrum.md to .wolf/archive/cerebrum-<timestamp>.md
 * (lossless), THEN overwrite cerebrum.md with `result`. If the backup fails,
 * throw and leave the existing cerebrum.md untouched — a bad AI result
 * (hallucination / truncation) must never destroy known-good knowledge.
 * (OPT-13: ai_task used to overwrite cerebrum.md with no backup.)
 * Returns the backup file path, or null when there was no prior cerebrum.md.
 */
export function backupAndWriteCerebrum(wolfDir: string, result: string): string | null {
  const cerebrumPath = path.join(wolfDir, "cerebrum.md");
  let backupPath: string | null = null;
  if (fs.existsSync(cerebrumPath)) {
    const archiveDir = path.join(wolfDir, "archive");
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    backupPath = path.join(archiveDir, `cerebrum-${stamp}.md`);
    try {
      fs.copyFileSync(cerebrumPath, backupPath);
    } catch (e) {
      throw new Error(`cerebrum backup failed (refusing to overwrite cerebrum.md): ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  fs.writeFileSync(cerebrumPath, result, "utf-8");
  return backupPath;
}
