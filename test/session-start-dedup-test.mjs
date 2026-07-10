// G-session-start-dedup: OPT-37 total_sessions dedup by payload session_id.
//
// Before OPT-37, session-start.ts incremented lifetime.total_sessions on every
// SessionStart event unconditionally. Claude Code / codex can fire SessionStart
// more than once per logical session (reconnect), inflating the count. The fix
// reads the payload's session_id and skips the increment when it matches the
// last one counted (stored as lifetime.last_session_id).
//
// This gate RUNS the dedup behavior, not just the source:
//   1. session_id "A" → total_sessions 1, last_session_id "A"
//   2. session_id "A" again → total_sessions still 1 (deduped)
//   3. session_id "B" → total_sessions 2
//   4. no session_id (empty payload) → total_sessions 3 (backward-compat increment)
//
// Run: node test/session-start-dedup-test.mjs
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const OPENWOLF_ROOT = path.resolve(import.meta.dirname, "..");
const DIST_HOOKS = path.join(OPENWOLF_ROOT, "dist", "hooks");
const TESTDIR = path.join(OPENWOLF_ROOT, ".session-start-dedup-test");

let pass = 0, fail = 0;
function assert(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

function deploy() {
  fs.rmSync(TESTDIR, { recursive: true, force: true });
  const hooksDir = path.join(TESTDIR, ".wolf", "hooks");
  fs.mkdirSync(path.join(hooksDir, "adapters"), { recursive: true });
  fs.mkdirSync(path.join(hooksDir, "descriptions"), { recursive: true });
  for (const f of ["session-start.js", "shared.js"]) {
    fs.copyFileSync(path.join(DIST_HOOKS, f), path.join(hooksDir, f));
  }
  for (const f of fs.readdirSync(path.join(DIST_HOOKS, "adapters"))) {
    if (f.endsWith(".js")) fs.copyFileSync(path.join(DIST_HOOKS, "adapters", f), path.join(hooksDir, "adapters", f));
  }
  for (const f of fs.readdirSync(path.join(DIST_HOOKS, "descriptions"))) {
    if (f.endsWith(".js")) fs.copyFileSync(path.join(DIST_HOOKS, "descriptions", f), path.join(hooksDir, "descriptions", f));
  }
  fs.writeFileSync(path.join(hooksDir, "package.json"), JSON.stringify({ type: "module" }));
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "token-ledger.json"),
    JSON.stringify({ version: 1, lifetime: { total_sessions: 0 } }, null, 2));
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "cerebrum.md"), "# Cerebrum\n");
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "buglog.json"), JSON.stringify({ version: 1, bugs: [] }));
}

function readLedger() {
  return JSON.parse(fs.readFileSync(path.join(TESTDIR, ".wolf", "token-ledger.json"), "utf8"));
}

function runSessionStart(payload) {
  return spawnSync("node", [".wolf/hooks/session-start.js"], {
    cwd: TESTDIR, encoding: "utf8", input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PROJECT_DIR: TESTDIR },
  });
}

console.log("── OPT-37: total_sessions dedup by payload session_id ──");
deploy();

runSessionStart({ session_id: "sess-A", hook_event_name: "SessionStart" });
let l = readLedger();
assert("first session_id 'A' → total_sessions === 1", l.lifetime.total_sessions === 1, `got ${l.lifetime.total_sessions}`);
assert("last_session_id recorded as 'A'", l.lifetime.last_session_id === "sess-A", `got ${l.lifetime.last_session_id}`);

runSessionStart({ session_id: "sess-A", hook_event_name: "SessionStart" });
l = readLedger();
assert("repeat session_id 'A' → total_sessions still 1 (reconnect deduped)",
  l.lifetime.total_sessions === 1, `got ${l.lifetime.total_sessions}`);

runSessionStart({ session_id: "sess-B", hook_event_name: "SessionStart" });
l = readLedger();
assert("new session_id 'B' → total_sessions === 2", l.lifetime.total_sessions === 2, `got ${l.lifetime.total_sessions}`);
assert("last_session_id updated to 'B'", l.lifetime.last_session_id === "sess-B", `got ${l.lifetime.last_session_id}`);

runSessionStart({ hook_event_name: "SessionStart" });
l = readLedger();
assert("no session_id in payload → total_sessions === 3 (backward-compat increment)",
  l.lifetime.total_sessions === 3, `got ${l.lifetime.total_sessions}`);

// cleanup
fs.rmSync(TESTDIR, { recursive: true, force: true });
console.log(`\n${fail === 0 ? "ALL GREEN" : `${fail} FAILED`} (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
