// G-cerebrum-backup: cerebrum.md backup-before-overwrite + memory count-cap gate.
// Covers OPT-13 (ai_task overwrote cerebrum.md with no backup → data-loss risk
// when an AI result hallucinates/truncates) and OPT-7 (cron consolidate_memory
// never passed max_entries → the count-based cap never fired from cron).
//
// backupAndWriteCerebrum (OPT-13) is the safe-write primitive extracted from
// cron-engine.runAiTask so it's unit-testable — runAiTask itself spawns `claude -p`
// and can't be exercised in a gate, so testing the primitive directly is the
// false-green guard (an inlined, untested backup could silently stop running).
// consolidateMemory's count-based cap (OPT-7 premise: max_entries, when passed,
// archives oldest sessions until under the cap) is tested directly —
// regress-claude only exercises the date-based archive branch, not this one.

import { backupAndWriteCerebrum, consolidateMemory } from "../dist/hooks/prune.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${msg}`);
  } else {
    fail++;
    console.error(`  ✗ ${msg}`);
  }
}

const month = new Date().toISOString().slice(0, 7);
const today = new Date().toISOString().slice(0, 10);

function sessionBlock(label, nRows) {
  const rows = Array.from({ length: nRows }, (_, i) => `| ${label}-${i} | edit | ${label}.ts | x | ~10 |`);
  return `## Session: ${today} ${label}\n\n| Time | Action | File(s) | Outcome | ~Tokens |\n|------|--------|---------|---------|--------|\n${rows.join("\n")}`;
}
function memoryWith(sessions) {
  return `# Memory\n\n> Auto-maintained by OpenWolf.\n\n` + sessions.join("\n\n") + "\n";
}

// ─── 1. backupAndWriteCerebrum: backs up OLD then overwrites (happy path) ──
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ow-cereb-backup-"));
  const wolfDir = path.join(tmp, ".wolf");
  fs.mkdirSync(wolfDir, { recursive: true });
  const oldContent = "# Cerebrum\n\n## User Preferences\n- old pref\n";
  fs.writeFileSync(path.join(wolfDir, "cerebrum.md"), oldContent, "utf-8");

  const newContent = "# Cerebrum\n\n## User Preferences\n- new pref\n";
  const backup = backupAndWriteCerebrum(wolfDir, newContent);

  assert(backup !== null, `returns backup path (non-null) when prior cerebrum existed`);
  assert(fs.existsSync(backup), `backup file created at ${path.basename(backup)}`);
  assert(fs.readFileSync(backup, "utf-8") === oldContent, `backup contains OLD cerebrum content (lossless)`);
  assert(fs.readFileSync(path.join(wolfDir, "cerebrum.md"), "utf-8") === newContent, `cerebrum.md overwritten with NEW content`);
  assert(/cerebrum-\d{4}-\d{2}-\d{2}T/.test(path.basename(backup)), `backup filename is timestamped cerebrum-<ISO>.md`);

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ─── 2. No prior cerebrum.md → no backup, just writes the new file ──
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ow-cereb-new-"));
  const wolfDir = path.join(tmp, ".wolf");
  fs.mkdirSync(wolfDir, { recursive: true });
  // No cerebrum.md exists yet.
  const result = "# Cerebrum\n\n## Key Learnings\n- fresh\n";
  const backup = backupAndWriteCerebrum(wolfDir, result);

  assert(backup === null, `returns null when no prior cerebrum.md`);
  assert(!fs.existsSync(path.join(wolfDir, "archive")), `no archive dir created when nothing to back up`);
  assert(fs.readFileSync(path.join(wolfDir, "cerebrum.md"), "utf-8") === result, `cerebrum.md created with the new content`);

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ─── 3. Backup fails → throws, existing cerebrum.md preserved (data-safe) ──
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ow-cereb-fail-"));
  const wolfDir = path.join(tmp, ".wolf");
  fs.mkdirSync(wolfDir, { recursive: true });
  const oldContent = "# Cerebrum\n\n## User Preferences\n- precious\n";
  fs.writeFileSync(path.join(wolfDir, "cerebrum.md"), oldContent, "utf-8");
  // Sabotage: make `archive` a FILE (not a dir) so copyFileSync into it fails.
  fs.writeFileSync(path.join(wolfDir, "archive"), "blocker", "utf-8");

  let threw = false;
  let errMsg = "";
  try {
    backupAndWriteCerebrum(wolfDir, "# Cerebrum\nbad overwrite\n");
  } catch (e) {
    threw = true;
    errMsg = e instanceof Error ? e.message : String(e);
  }

  assert(threw, `backup failure throws (does not silently overwrite)`);
  assert(/cerebrum backup failed/.test(errMsg), `throw message names the backup failure (${errMsg.slice(0, 60)})`);
  assert(fs.readFileSync(path.join(wolfDir, "cerebrum.md"), "utf-8") === oldContent, `existing cerebrum.md UNCHANGED (precious data preserved)`);

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ─── 4. consolidateMemory count-cap (OPT-7 premise): max_entries archives oldest ──
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ow-cereb-countcap-"));
  const wolfDir = path.join(tmp, ".wolf");
  fs.mkdirSync(wolfDir, { recursive: true });
  // 5 recent sessions (dated today, so the date-based archive keeps ALL of them),
  // each with 5 data rows = 25 rows total. max_entries=10 → the count-based cap
  // archives the oldest 3 sessions, keeping the newest 2 (10 rows).
  const sessions = ["s1", "s2", "s3", "s4", "s5"].map((l) => sessionBlock(l, 5));
  const memPath = path.join(wolfDir, "memory.md");
  fs.writeFileSync(memPath, memoryWith(sessions), "utf-8");

  consolidateMemory(wolfDir, 7, 10); // older_than_days=7 (recent → kept by date), max_entries=10

  const after = fs.readFileSync(memPath, "utf-8");
  const sessionCount = (after.match(/^## Session:/gm) || []).length;
  assert(sessionCount === 2, `count-cap keeps 2 newest sessions (got ${sessionCount})`);
  assert(/## Session:.*s4\b/.test(after) && /## Session:.*s5\b/.test(after), `kept the NEWEST two (s4, s5)`);
  assert(!/## Session:.*s1\b/.test(after) && !/## Session:.*s2\b/.test(after) && !/## Session:.*s3\b/.test(after), `archived the oldest three (s1, s2, s3)`);

  // Lossless: the 3 archived sessions live verbatim in the monthly archive.
  const archivePath = path.join(wolfDir, "archive", `memory-${month}.md`);
  assert(fs.existsSync(archivePath), `archive/memory-${month}.md created`);
  const arch = fs.readFileSync(archivePath, "utf-8");
  const archCount = (arch.match(/^## Session:/gm) || []).length;
  assert(archCount === 3, `archive holds 3 archived sessions (lossless, got ${archCount})`);
  assert(/## Session:.*s1\b/.test(arch) && /## Session:.*s2\b/.test(arch) && /## Session:.*s3\b/.test(arch), `archive contains s1, s2, s3`);

  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nG-cerebrum-backup: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
