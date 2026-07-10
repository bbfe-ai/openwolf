// G-post-write-stderr: post-write step failures surface to stderr (OPT-36).
//
// Before OPT-36, post-write had 5 empty `catch {}` blocks that swallowed real
// I/O / JSON errors (anatomy write, memory append, session tracker, auto-detect).
// The 03 doc cited L63/121/155/166/176 (drifted); the actual 5 that mask real
// errors are the anatomy-fallback-write, anatomy-update-outer, memory-append,
// session-tracker, and auto-detect catches. 4 other catches are LEGITIMATELY
// silent (read-fallbacks when a file is missing, rename-fallback, tmp cleanup)
// and left as-is.
//
// Fix: a warnPostWriteFailure(step, e) helper writes to stderr, preserving the
// best-effort behavior (post-write never blocks the edit, still exits 0). Gate:
// trigger the memory-append catch for real (memory.md sabotaged as a directory →
// appendMarkdown EISDIR) and assert stderr is written + exit 0; happy path
// control (no stderr on success); source check that the helper + all 5 step
// names landed in dist and exactly 5 catches are wired (6 = 1 def + 5 calls).

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const OPENWOLF_ROOT = path.resolve(import.meta.dirname, "..");
const HOOKS = path.join(OPENWOLF_ROOT, "dist", "hooks");
const TESTDIR = path.join(OPENWOLF_ROOT, ".postwrite-stderr-test");

// log_edits: true enables the memory-append step so we can trigger its catch.
const CONFIG = {
  version: 1,
  openwolf: {
    memory: { log_edits: true, consolidation_after_days: 7, max_entries_before_consolidation: 200 },
    buglog: { auto_detect: false, max_entries: 200 },
  },
};

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

function setup(sabotageMemory) {
  fs.rmSync(TESTDIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(TESTDIR, "src"), { recursive: true });
  fs.mkdirSync(path.join(TESTDIR, ".wolf", "hooks"), { recursive: true });
  for (const f of fs.readdirSync(HOOKS)) {
    if (f.endsWith(".js")) fs.copyFileSync(path.join(HOOKS, f), path.join(TESTDIR, ".wolf", "hooks", f));
  }
  const adaptSrc = path.join(HOOKS, "adapters");
  if (fs.existsSync(adaptSrc)) {
    fs.mkdirSync(path.join(TESTDIR, ".wolf", "hooks", "adapters"), { recursive: true });
    for (const f of fs.readdirSync(adaptSrc)) {
      if (f.endsWith(".js")) fs.copyFileSync(path.join(adaptSrc, f), path.join(TESTDIR, ".wolf", "hooks", "adapters", f));
    }
  }
  // Deploy the descriptions subdirectory — shared.js imports ./descriptions/known.js (OPT-33).
  const descSrc = path.join(HOOKS, "descriptions");
  if (fs.existsSync(descSrc)) {
    fs.mkdirSync(path.join(TESTDIR, ".wolf", "hooks", "descriptions"), { recursive: true });
    for (const f of fs.readdirSync(descSrc)) {
      if (f.endsWith(".js")) fs.copyFileSync(path.join(descSrc, f), path.join(TESTDIR, ".wolf", "hooks", "descriptions", f));
    }
  }
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "config.json"), JSON.stringify(CONFIG));
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "anatomy.md"), "# anatomy.md\n\n> Auto-maintained.\n## src/\n- `app.ts` — pre (~10 tok)\n");
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "buglog.json"), JSON.stringify({ version: 1, bugs: [] }));
  fs.writeFileSync(path.join(TESTDIR, "src", "app.ts"), "export const X = 1;\n");
  if (sabotageMemory) {
    // memory.md is a DIRECTORY → appendMarkdown's appendFileSync throws EISDIR
    // → the memory-append catch fires → warnPostWriteFailure → stderr.
    fs.mkdirSync(path.join(TESTDIR, ".wolf", "memory.md"));
  } else {
    fs.writeFileSync(path.join(TESTDIR, ".wolf", "memory.md"), "# Memory\n\n");
  }
}

function runPostWrite() {
  return spawnSync("node", [path.join(TESTDIR, ".wolf", "hooks", "post-write.js")], {
    cwd: TESTDIR,
    env: { ...process.env, CLAUDE_PROJECT_DIR: TESTDIR },
    input: JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: path.join(TESTDIR, "src", "app.ts"), old_string: "X = 1", new_string: "X = 2" },
    }),
    encoding: "utf-8",
    timeout: 30000,
  });
}

if (!fs.existsSync(HOOKS)) { console.error("✗ Build missing. Run build:hooks first."); process.exit(2); }

// ─── 1. memory.md sabotaged (directory) → "memory append" failure on stderr ──
{
  setup(true);
  const r = runPostWrite();
  const stderr = r.stderr || "";
  assert(r.status === 0, `sabotage: post-write exits 0 even when a step fails (best-effort, never blocks edit) — status=${r.status}`);
  assert(stderr.includes("memory append"), `sabotage: stderr includes "memory append" step name (got: "${stderr.trim().slice(0, 140)}")`);
  assert(/failed/i.test(stderr), `sabotage: stderr mentions "failed"`);
  assert(stderr.includes("openwolf post-write:"), `sabotage: stderr uses the "openwolf post-write:" prefix`);
}

// ─── 2. happy path (memory.md is a file) → NO failure on stderr ──
{
  setup(false);
  const r = runPostWrite();
  const stderr = r.stderr || "";
  assert(r.status === 0, `happy: post-write exits 0 — status=${r.status}`);
  assert(!stderr.includes("openwolf post-write:"), `happy: no "openwolf post-write:" failure on stderr (not noisy; got: "${stderr.trim().slice(0, 140)}")`);
  // Prove the memory-append step actually ran + succeeded (memory.md grew) —
  // confirms log_edits was honored and the step worked (no silent skip).
  const mem = fs.readFileSync(path.join(TESTDIR, ".wolf", "memory.md"), "utf-8");
  assert(mem.includes("app.ts"), `happy: memory.md gained the edit entry (memory-append step ran + succeeded)`);
}

// ─── 3. source: dist has helper + all 5 step names, exactly 5 catches wired ──
{
  const dist = fs.readFileSync(path.join(HOOKS, "post-write.js"), "utf-8");
  assert(dist.includes("warnPostWriteFailure"), `dist has warnPostWriteFailure helper`);
  const steps = ["anatomy fallback write", "anatomy update", "memory append", "session tracker", "auto-detect bug fix"];
  for (const s of steps) {
    assert(dist.includes(`"${s}"`), `dist has step name "${s}"`);
  }
  const callCount = (dist.match(/warnPostWriteFailure\(/g) || []).length;
  assert(callCount === 6, `dist has exactly 6 warnPostWriteFailure references (1 def + 5 calls; got ${callCount})`);
}

fs.rmSync(TESTDIR, { recursive: true, force: true });
console.log(`\nG-post-write-stderr: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
