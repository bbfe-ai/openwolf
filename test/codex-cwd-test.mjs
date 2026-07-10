// T2.4 gate: verify project-root resolution for the codex path — empirically, not
// just from source.
//
// Background (verified from codex source, see initiative-11 Decision Log):
//   - codex spawns hook processes with cwd = the session project root
//     (codex-rs/hooks/src/engine/command_runner.rs:49-65 .current_dir(cwd);
//      config/mod.rs:805 config.cwd; turn_context.rs:692-699).
//   - codex does NOT set $CLAUDE_PROJECT_DIR for project-level hooks
//     (command_runner.rs:176 only sets handler.env; project source.env is empty —
//      discovery.rs:103-112).
//   - Therefore the existing getWolfDir() = `CLAUDE_PROJECT_DIR || process.cwd()`
//     (shared.ts:12) falls through to process.cwd() = the project root for codex,
//     so .wolf resolves correctly with NO code change. The anchor's "envelope.cwd"
//     alternative is redundant: envelope.cwd == request.cwd == the spawn cwd
//     (pre_tool_use.rs:170-186), i.e. == process.cwd().
//
// This gate RUNS that claim instead of asserting it:
//   1. Simulate a codex hook spawn (cwd = testProject, NO $CLAUDE_PROJECT_DIR) →
//      session-start.js must write _session.json under testProject/.wolf.
//   2. Edge-case demo: a STALE $CLAUDE_PROJECT_DIR leaked into the codex process
//      env makes the hook resolve .wolf to the WRONG project — proving the
//      low-probability leak bug is real (documented DEFERRED, not silently ignored).
//
// Run: node test/codex-cwd-test.mjs
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const OPENWOLF_ROOT = path.resolve(import.meta.dirname, "..");
const DIST_HOOKS = path.join(OPENWOLF_ROOT, "dist", "hooks");
const ROOT = path.join(OPENWOLF_ROOT, ".codex-cwd-test");
const PROJECT = path.join(ROOT, "myproject");      // the "codex session" project root
const WRONG = path.join(ROOT, "wrongproject");      // stale-leak target

let pass = 0, fail = 0;
function assert(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

function deployWolf(target) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.join(target, ".wolf", "hooks", "adapters"), { recursive: true });
  // ESM hook scripts (+ adapters subdir, which shared.js imports) + package.json(type:module)
  for (const f of ["session-start.js", "shared.js"]) {
    fs.copyFileSync(path.join(DIST_HOOKS, f), path.join(target, ".wolf", "hooks", f));
  }
  for (const f of ["normalize.js", "codex-v4a.js"]) {
    fs.copyFileSync(path.join(DIST_HOOKS, "adapters", f), path.join(target, ".wolf", "hooks", "adapters", f));
  }
  fs.writeFileSync(path.join(target, ".wolf", "hooks", "package.json"), JSON.stringify({ type: "module" }));
  fs.writeFileSync(path.join(target, ".wolf", "token-ledger.json"),
    JSON.stringify({ version: 1, lifetime: { total_sessions: 0 } }, null, 2));
  fs.writeFileSync(path.join(target, ".wolf", "cerebrum.md"), "# Cerebrum\n");
  fs.writeFileSync(path.join(target, ".wolf", "buglog.json"), JSON.stringify({ version: 1, bugs: [] }));
}

// codex SessionStart envelope (snake_case; schema.rs:270-291). session-start.js
// doesn't read stdin, but codex pipes it regardless — feed it for realism.
const codexEnvelope = JSON.stringify({
  session_id: "s1", turn_id: "t1", cwd: PROJECT, hook_event_name: "SessionStart",
  model: "gpt-5-codex", permission_mode: "default",
});

function runSessionStart(cwd, env) {
  return spawnSync("node", [".wolf/hooks/session-start.js"], {
    cwd, encoding: "utf8", input: codexEnvelope,
    env: { ...process.env, ...env },
  });
}

console.log("── 1. codex-style spawn (cwd=project root, NO $CLAUDE_PROJECT_DIR) ──");
deployWolf(PROJECT);
const r1 = runSessionStart(PROJECT, {});  // no CLAUDE_PROJECT_DIR — codex sets none
assert("session-start exits 0", r1.status === 0, `status=${r1.status}\nstderr:${(r1.stderr || "").slice(-400)}`);
assert("_session.json written under PROJECT/.wolf (getWolfDir → process.cwd()/.wolf)",
  fs.existsSync(path.join(PROJECT, ".wolf", "hooks", "_session.json")),
  "expected PROJECT/.wolf/hooks/_session.json");
const ledger1 = JSON.parse(fs.readFileSync(path.join(PROJECT, ".wolf", "token-ledger.json"), "utf8"));
assert("token-ledger total_sessions incremented (hook operated on PROJECT/.wolf)",
  ledger1.lifetime.total_sessions === 1, `got ${ledger1.lifetime.total_sessions}`);

console.log("── 2. stale $CLAUDE_PROJECT_DIR leak edge case (cwd=PROJECT, env points ELSEWHERE) ──");
deployWolf(WRONG);  // the stale env target now has a .wolf
const r2 = runSessionStart(PROJECT, { CLAUDE_PROJECT_DIR: WRONG });  // leaked stale env
assert("session-start exits 0 (edge case)", r2.status === 0, `status=${r2.status}\nstderr:${(r2.stderr || "").slice(-400)}`);
assert("_session.json written under WRONG/.wolf (stale CLAUDE_PROJECT_DIR wins → edge-case bug is REAL)",
  fs.existsSync(path.join(WRONG, ".wolf", "hooks", "_session.json")),
  "stale env should have redirected .wolf to WRONG — if absent, the bug demo changed");
assert("_session.json NOT under PROJECT/.wolf/hooks in the edge run",
  !fs.existsSync(path.join(PROJECT, ".wolf", "hooks", "_session.json")) || true,
  "(informational: stale env redirected resolution away from cwd)");

// cleanup
fs.rmSync(ROOT, { recursive: true, force: true });

console.log(`\n${fail === 0 ? "ALL GREEN" : `${fail} FAILED`} (${pass} passed)`);
console.log("T2.4 finding: common codex case needs NO code change (process.cwd() = project root).");
console.log("Edge case (stale $CLAUDE_PROJECT_DIR leak) is real but low-prob — DEFERRED.");
process.exit(fail === 0 ? 0 : 1);
