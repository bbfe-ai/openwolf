// G-ledger-prune: token-ledger.json rolling cap gate (OPT-9, P1).
//
// token-ledger.json was the fourth bloat file: stop.ts pushes one SessionEntry
// per session into sessions[] with no cap, so the file grew linearly with
// session count. ledgerCap (mirroring buglogCap) archives the oldest overflow
// verbatim to .wolf/archive/ledger-YYYYMM.json — lossless — and keeps the newest
// maxK; lifetime totals are cumulative and never touched. runPrune calls it
// every Stop hook with ledger.max_sessions (default 200).
//
// ledgerCap is tested DIRECTLY in-process (it takes wolfDir+maxK explicitly —
// no config, no cache). runPrune's config wiring is tested via a FRESH spawned
// process per scenario: readConfig() caches module-level, so each scenario
// needs a clean cache (same reason regress-claude spawns each hook fresh).

import { ledgerCap } from "../dist/hooks/prune.js";
import { spawnSync } from "node:child_process";
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

const month = new Date().toISOString().slice(0, 7).replace("-", "");
const OPENWOLF_ROOT = path.resolve(import.meta.dirname, "..");
const RUNNER = path.join(OPENWOLF_ROOT, "test", "ledger-prune-runner.mjs");

function makeLedger(n) {
  const sessions = [];
  for (let i = 0; i < n; i++) {
    const day = String((i % 28) + 1).padStart(2, "0");
    sessions.push({
      id: `s${String(i).padStart(3, "0")}`,
      started: `2026-07-${day}T00:00:00.000Z`,
      ended: `2026-07-${day}T01:00:00.000Z`,
      totals: { input_tokens_estimated: i * 10, output_tokens_estimated: i * 5 },
    });
  }
  return {
    version: 1,
    created_at: "2020-01-01T00:00:00.000Z",
    lifetime: { total_sessions: n, total_tokens_estimated: 12345 },
    sessions,
    daemon_usage: [{ foo: "preserve-me" }],
    waste_flags: [],
  };
}

function writeLedger(projectRoot, ledger) {
  const wolfDir = path.join(projectRoot, ".wolf");
  fs.mkdirSync(wolfDir, { recursive: true });
  fs.writeFileSync(path.join(wolfDir, "token-ledger.json"), JSON.stringify(ledger, null, 2));
  return wolfDir;
}
function readLedger(wolfDir) {
  return JSON.parse(fs.readFileSync(path.join(wolfDir, "token-ledger.json"), "utf-8"));
}
function spawnRunPrune(projectRoot) {
  return spawnSync("node", [RUNNER], {
    cwd: projectRoot,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
    encoding: "utf-8",
    timeout: 30000,
  });
}

// ─── 1. ledgerCap caps + archives losslessly (direct, in-process) ──
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ow-ledger-cap-"));
  const wolfDir = writeLedger(tmp, makeLedger(250));
  const archived = ledgerCap(wolfDir, 200);
  const after = readLedger(wolfDir);

  assert(archived === 50, `archived count === 50 (got ${archived})`);
  assert(after.sessions.length === 200, `sessions capped to 200 (got ${after.sessions.length})`);
  assert(after.sessions[0].id === "s050", `kept[0] is newest-half start s050 (got ${after.sessions[0].id})`);
  assert(after.sessions[199].id === "s249", `kept[199] is newest s249 (got ${after.sessions[199].id})`);
  assert(after.lifetime.total_sessions === 250, `lifetime.total_sessions preserved (cumulative, not touched)`);
  assert(after.lifetime.total_tokens_estimated === 12345, `lifetime.total_tokens_estimated preserved`);
  assert(JSON.stringify(after.daemon_usage) === JSON.stringify([{ foo: "preserve-me" }]), `daemon_usage preserved (other fields untouched)`);
  assert(after.version === 1, `version preserved`);

  const archivePath = path.join(wolfDir, "archive", `ledger-${month}.json`);
  assert(fs.existsSync(archivePath), `archive file created at archive/ledger-${month}.json`);
  const arch = JSON.parse(fs.readFileSync(archivePath, "utf-8"));
  assert(Array.isArray(arch.sessions) && arch.sessions.length === 50, `archive has 50 entries (got ${arch.sessions?.length})`);
  assert(arch.sessions[0].id === "s000" && arch.sessions[49].id === "s049", `archive holds oldest s000..s049 (lossless)`);

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ─── 2. No-op edges: maxK=0 (no-limit) and already-under-cap ──
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ow-ledger-noop-"));
  const wolfDir = writeLedger(tmp, makeLedger(50));

  const archived0 = ledgerCap(wolfDir, 0);
  assert(archived0 === 0, `maxK=0 returns 0 (no-limit semantic, parity with OPT-12)`);
  assert(!fs.existsSync(path.join(wolfDir, "archive")), `maxK=0 creates no archive`);
  assert(readLedger(wolfDir).sessions.length === 50, `maxK=0 leaves sessions untouched`);

  const archivedUnder = ledgerCap(wolfDir, 200);
  assert(archivedUnder === 0, `under-cap (50 <= 200) returns 0`);
  assert(!fs.existsSync(path.join(wolfDir, "archive")), `under-cap creates no archive`);

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ─── 3. Idempotent: capping an already-capped ledger is a no-op ──
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ow-ledger-idem-"));
  const wolfDir = writeLedger(tmp, makeLedger(250));
  ledgerCap(wolfDir, 200);
  const firstAfter = readLedger(wolfDir);
  const secondArchived = ledgerCap(wolfDir, 200);
  const secondAfter = readLedger(wolfDir);

  assert(secondArchived === 0, `second cap is no-op (already at 200)`);
  assert(secondAfter.sessions.length === 200, `idempotent: still 200`);
  assert(JSON.stringify(secondAfter) === JSON.stringify(firstAfter), `idempotent: ledger byte-identical after 2nd cap`);
  const arch = JSON.parse(fs.readFileSync(path.join(wolfDir, "archive", `ledger-${month}.json`), "utf-8"));
  assert(arch.sessions.length === 50, `idempotent: archive not doubled (still 50)`);

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ─── 4. runPrune reads ledger.max_sessions from config (fresh process) ──
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ow-ledger-cfg-"));
  const wolfDir = writeLedger(tmp, makeLedger(25));
  fs.writeFileSync(
    path.join(wolfDir, "config.json"),
    JSON.stringify({ openwolf: { ledger: { max_sessions: 10 } } }, null, 2),
  );
  const r = spawnRunPrune(tmp);
  assert(r.status === 0, `runPrune runner exited 0 (got ${r.status}${r.stderr ? `, stderr=${r.stderr.slice(0, 200)}` : ""})`);
  const after = readLedger(wolfDir);
  assert(after.sessions.length === 10, `runPrune caps to 10 via ledger.max_sessions (got ${after.sessions.length})`);
  assert(after.sessions[0].id === "s015" && after.sessions[9].id === "s024", `runPrune kept newest 10 (s015..s024)`);
  const arch = JSON.parse(fs.readFileSync(path.join(wolfDir, "archive", `ledger-${month}.json`), "utf-8"));
  assert(arch.sessions.length === 15, `runPrune archived 15 overflow`);

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ─── 5. runPrune default (no config) caps at 200 (fresh process) ──
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ow-ledger-def-"));
  const wolfDir = writeLedger(tmp, makeLedger(205)); // just over the default 200
  // No config.json → readConfig returns {} → ledgerMax defaults to 200.
  const r = spawnRunPrune(tmp);
  assert(r.status === 0, `runPrune runner (no config) exited 0 (got ${r.status})`);
  const after = readLedger(wolfDir);
  assert(after.sessions.length === 200, `default cap 200 applies with no config (got ${after.sessions.length})`);
  assert(after.sessions[0].id === "s005", `default cap kept newest 200 (s005..s204, got ${after.sessions[0].id})`);

  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nG-ledger-prune: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
