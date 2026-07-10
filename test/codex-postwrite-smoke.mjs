// T2.5 (a) codex post-write integration smoke — proves the normalize seam wired
// into post-write.js (initiative 11) actually processes a real Codex PostToolUse
// apply_patch envelope end-to-end and mutates .wolf/ state for the V4A-extracted
// file(s). This is the NON-false-green proof.
//
// Before the wiring, post-write.js read stdin as Claude-shape: a codex apply_patch
// envelope has tool_input.command (the V4A patch), NOT tool_input.file_path — so
// the old `if (!filePath) process.exit(0)` fired and the body never ran. .wolf/
// state would NOT change, and a "memory not growing" e2e would pass VACUOUSLY.
// Here anatomy + session MUST change for the patched file (proving the codex event
// flowed through readNormalizedStdin → normalizeCodex → parseV4APatch → processOne),
// while gating still suppresses memory/buglog growth (C3/C4 hold for codex too).
//
// Run: node test/codex-postwrite-smoke.mjs
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const OPENWOLF_ROOT = path.resolve(import.meta.dirname, "..");
const HOOKS = path.join(OPENWOLF_ROOT, "dist", "hooks");
const TESTDIR = path.join(OPENWOLF_ROOT, ".codex-postwrite-smoke");

// v1.1.0 default config: gating OFF (memory) + auto_detect OFF (buglog). Same as
// regress-claude.mjs — this is what makes the no-growth assertions meaningful.
const CONFIG = {
  version: 1,
  memory: { log_edits: false, consolidation_after_days: 7, max_entries_before_consolidation: 200 },
  buglog: { auto_detect: false, max_entries: 200 },
};

const INITIAL_MEMORY = "# Memory\n\n> Auto-maintained by OpenWolf.\n";
const INITIAL_ANATOMY = "# anatomy.md\n\n> Auto-maintained.\n## src/\n- `other.ts` — pre-existing (~10 tok)\n";

let pass = 0, fail = 0;
function assert(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

function setup() {
  fs.rmSync(TESTDIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(TESTDIR, "src"), { recursive: true });
  fs.mkdirSync(path.join(TESTDIR, ".wolf", "hooks"), { recursive: true });
  for (const f of fs.readdirSync(HOOKS)) {
    if (f.endsWith(".js")) fs.copyFileSync(path.join(HOOKS, f), path.join(TESTDIR, ".wolf", "hooks", f));
  }
  // Deploy the adapter subdirectory — shared.js imports ./adapters/normalize.js.
  // Without this the hook fails to load (ERR_MODULE_NOT_FOUND) and every
  // assertion becomes a false positive (silent exit 0 with no body run).
  const adaptSrc = path.join(HOOKS, "adapters");
  const adaptDst = path.join(TESTDIR, ".wolf", "hooks", "adapters");
  if (fs.existsSync(adaptSrc)) {
    fs.mkdirSync(adaptDst, { recursive: true });
    for (const f of fs.readdirSync(adaptSrc)) {
      if (f.endsWith(".js")) fs.copyFileSync(path.join(adaptSrc, f), path.join(adaptDst, f));
    }
  }
  // Deploy the descriptions subdirectory — shared.js imports ./descriptions/known.js (OPT-33).
  const descSrc = path.join(HOOKS, "descriptions");
  const descDst = path.join(TESTDIR, ".wolf", "hooks", "descriptions");
  if (fs.existsSync(descSrc)) {
    fs.mkdirSync(descDst, { recursive: true });
    for (const f of fs.readdirSync(descSrc)) {
      if (f.endsWith(".js")) fs.copyFileSync(path.join(descSrc, f), path.join(descDst, f));
    }
  }
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "config.json"), JSON.stringify(CONFIG));
  // anatomy starts WITHOUT app.ts/util.ts — the hook must ADD them (state delta
  // is the proof the body ran; pre-wiring it would not).
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "anatomy.md"), INITIAL_ANATOMY);
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "cerebrum.md"), "# cerebrum.md\n\n## Do-Not-Repeat\n- never use eval\n");
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "memory.md"), INITIAL_MEMORY);
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "buglog.json"), JSON.stringify({ version: 1, bugs: [] }));
  // The two files the V4A patch touches — must exist on disk so post-write can
  // readFileSync them for token estimation (mirrors real codex editing a real file).
  fs.writeFileSync(path.join(TESTDIR, "src", "app.ts"), 'export function greet(name) {\n  return "hello " + name;\n}\n');
  fs.writeFileSync(path.join(TESTDIR, "src", "util.ts"), 'export const X = 1;\n');
}

// Spawn the hook with cwd=TESTDIR and NO CLAUDE_PROJECT_DIR — this is exactly the
// codex hook execution environment (Q1: codex spawns hooks cwd=project root, and
// codex injects 0 env vars for project hooks, so no CLAUDE_PROJECT_DIR). The hook
// resolves .wolf/ via process.cwd() (the path proven by codex-cwd-test).
function runHook(hookName, input) {
  return spawnSync("node", [path.join(TESTDIR, ".wolf", "hooks", hookName)], {
    cwd: TESTDIR,
    env: { ...process.env /* deliberately NO CLAUDE_PROJECT_DIR — codex path */ },
    input: JSON.stringify(input), encoding: "utf-8", timeout: 30000,
  });
}

// Codex PostToolUse envelope shape (schema.rs:270-291, snake_case): hook_event_name
// + turn_id are the codex-distinct fields detectAgent keys on; apply_patch carries
// the V4A patch in tool_input.command (NOT file_path — the pre-wiring trap).
function codexEnv(toolName, toolInput) {
  return {
    session_id: "s1", turn_id: "t1", cwd: TESTDIR.replace(/\\/g, "/"),
    hook_event_name: "PostToolUse", model: "gpt-5-codex", permission_mode: "default",
    tool_name: toolName, tool_input: toolInput, tool_use_id: "call_1",
  };
}

function anatomyText() { return fs.readFileSync(path.join(TESTDIR, ".wolf", "anatomy.md"), "utf-8"); }
function memoryText() { return fs.readFileSync(path.join(TESTDIR, ".wolf", "memory.md"), "utf-8"); }
function bugCount() { try { return JSON.parse(fs.readFileSync(path.join(TESTDIR, ".wolf", "buglog.json"), "utf-8")).bugs.length; } catch { return -1; } }
function session() {
  const p = path.join(TESTDIR, ".wolf", "hooks", "_session.json");
  if (!fs.existsSync(p)) return { files_written: [], edit_counts: {} };
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return { files_written: [], edit_counts: {} }; }
}

// ── run ──
if (!fs.existsSync(HOOKS)) { console.error("✗ Build missing. Run `pnpm build:hooks` first."); process.exit(2); }

// ── A. multi-file codex apply_patch → .wolf/ state MUST change for BOTH files ──
console.log("── A. multi-file codex apply_patch → .wolf/ state must change ──");
setup();
// V4A patch updating two files (app.ts + util.ts). Context-free replacement blocks.
const patch2 = "*** Begin Patch\n" +
  "*** Update File: src/app.ts\n" +
  "-  return \"hello \" + name;\n" +
  "+  return \"hi \" + name;\n" +
  "*** Update File: src/util.ts\n" +
  "-export const X = 1;\n" +
  "+export const X = 2;\n" +
  "*** End Patch";
const rA = runHook("post-write.js", codexEnv("apply_patch", { command: patch2 }));
assert("post-write.js exits 0 on codex envelope (no crash)", rA.status === 0, `status=${rA.status} stderr=${(rA.stderr||"").slice(0, 200)}`);

const anA = anatomyText();
assert("anatomy gained src/app.ts (V4A file_path #1 extracted → body ran)", anA.includes("app.ts"), "anatomy has no app.ts");
assert("anatomy gained src/util.ts (V4A file_path #2 extracted → loop ran N times)", anA.includes("util.ts"), "anatomy has no util.ts");

const sessA = session();
const filesA = (sessA.files_written || []).map((e) => e.file);
assert("session recorded 2 file-writes (multi-event loop ran both)", (sessA.files_written || []).length === 2, `got ${(sessA.files_written || []).length}`);
assert("session files include app.ts (V4A file_path matches constructed patch)", filesA.some((f) => f.includes("app.ts")), JSON.stringify(filesA));
assert("session files include util.ts (V4A file_path matches constructed patch)", filesA.some((f) => f.includes("util.ts")), JSON.stringify(filesA));

// Gating (C3/C4) must still hold for the codex path — non-false-green for gating:
// if the wiring accidentally bypassed config.memory.log_edits / buglog.auto_detect,
// these would grow. They must NOT.
assert("memory.md NOT grown by codex edits (log_edits OFF holds for codex)", memoryText() === INITIAL_MEMORY, "memory grew under gating");
assert("buglog.json NOT grown by codex edits (auto_detect OFF holds for codex)", bugCount() === 0, `got ${bugCount()} bugs`);

// ── B. negative control: codex Bash tool (non-file) → no-op, no spurious writes ──
console.log("── B. control: codex Bash tool (no file event) → .wolf/ state unchanged ──");
setup();
const rB = runHook("post-write.js", codexEnv("Bash", { command: "cat src/app.ts" }));
assert("post-write.js exits 0 on codex Bash (no crash, events empty)", rB.status === 0, `status=${rB.status}`);

const anB = anatomyText();
assert("anatomy UNCHANGED by codex Bash (no phantom entry written)", !anB.includes("app.ts") && !anB.includes("util.ts"), "anatomy gained a phantom entry");
const sessB = session();
assert("session has 0 file-writes for codex Bash (empty events no-op correctly)", (sessB.files_written || []).length === 0, `got ${(sessB.files_written || []).length}`);

console.log(`\n${fail === 0 ? "ALL GREEN" : `${fail} FAILED`} (${pass} passed)`);
fs.rmSync(TESTDIR, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
