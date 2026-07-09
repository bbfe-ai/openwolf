import * as fs from "node:fs";
import * as path from "node:path";
import { readJSON, writeJSON, readConfig } from "./shared.js";

// ─── Memory consolidation ────────────────────────────────────────
// Folds session tables in memory.md into one-line summaries. Runs from the
// Stop hook every session end (no daemon required) and, for compatibility,
// from the cron engine. Pure: takes an explicit wolfDir.

const FAR_FUTURE = new Date(8640000000000000);

function isTableRow(line: string): boolean {
  return line.startsWith("|") && !line.startsWith("|--") && !line.startsWith("| Time");
}

function fold(content: string, cutoff: Date): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let inOldSession = false;
  let oldSessionLines: string[] = [];

  const flush = () => {
    if (inOldSession && oldSessionLines.length > 0) {
      const actionCount = oldSessionLines.filter(isTableRow).length;
      result.push(`> Consolidated session (${actionCount} actions)`);
      result.push("");
    }
  };

  for (const line of lines) {
    const sessionMatch = line.match(/^## Session: (\d{4}-\d{2}-\d{2})/);
    if (sessionMatch) {
      flush();
      const currentSessionDate = new Date(sessionMatch[1]);
      inOldSession = currentSessionDate < cutoff;
      oldSessionLines = [];
      result.push(line); // Always keep the header
      continue;
    }
    if (inOldSession) oldSessionLines.push(line);
    else result.push(line);
  }
  flush();
  return result.join("\n");
}

/**
 * Consolidate memory.md sessions older than `olderThanDays`. If `maxEntries`
 * is given and the active (non-consolidated) table rows still exceed it after
 * the age pass, fold every session as a count-based safety net.
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

  let out = fold(content, cutoff);

  if (maxEntries && maxEntries > 0) {
    const activeRows = out.split("\n").filter(isTableRow).length;
    if (activeRows > maxEntries) out = fold(content, FAR_FUTURE);
  }

  if (out !== content) {
    const tmp = memoryPath + ".prune.tmp";
    try {
      fs.writeFileSync(tmp, out, "utf-8");
      fs.renameSync(tmp, memoryPath);
    } catch {
      try { fs.writeFileSync(memoryPath, out, "utf-8"); } catch {}
      try { fs.unlinkSync(tmp); } catch {}
    }
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

// ─── Combined entry point for the Stop hook ──────────────────────

/** Run all write-path governance using values from .wolf/config.json. */
export function runPrune(wolfDir: string): void {
  const mem = readConfig().memory ?? {};
  const bug = readConfig().buglog ?? {};
  const olderThanDays = typeof mem.consolidation_after_days === "number" ? mem.consolidation_after_days : 7;
  const maxEntries = typeof mem.max_entries_before_consolidation === "number" ? mem.max_entries_before_consolidation : 200;
  const bugMax = typeof bug.max_entries === "number" ? bug.max_entries : 200;
  try { consolidateMemory(wolfDir, olderThanDays, maxEntries); } catch {}
  try { buglogCap(wolfDir, bugMax); } catch {}
}
