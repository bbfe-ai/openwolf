// G-buglog-dedup-window: configurable dedup window for auto-detected bugs (OPT-3).
//
// Before OPT-3, autoDetectBugFix deduped same-file + same-category fixes within a
// hardcoded 5-min window. The 03 doc: 5 min too short → the same recurring fix
// logged as new bug entries. Fix: window is configurable via
// buglog.dedup_window_ms (default 30 min — was 5 min).
//
// Gate: (A) default window → immediate re-fix dedups; (B) dedup_window_ms:0 →
// re-fix does NOT dedup (config override honored); (C) short window + old
// last_seen → no dedup (boundary); (D) short window + recent last_seen → dedup;
// (E) source wiring. Trigger pattern: old `obj.prop` → new `obj?.prop` (null-safety).

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const OPENWOLF_ROOT = path.resolve(import.meta.dirname, "..");
const HOOKS_SRC = path.join(OPENWOLF_ROOT, "dist", "hooks");
const TESTDIR = path.join(OPENWOLF_ROOT, ".buglog-dedup-test");

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${msg}`); }
}

function deployHooks() {
  const dest = path.join(TESTDIR, ".wolf", "hooks");
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(HOOKS_SRC)) {
    const src = path.join(HOOKS_SRC, f);
    if (fs.statSync(src).isFile() && f.endsWith(".js")) fs.copyFileSync(src, path.join(dest, f));
  }
  const adaptSrc = path.join(HOOKS_SRC, "adapters");
  if (fs.existsSync(adaptSrc)) {
    const adaptDest = path.join(dest, "adapters");
    fs.mkdirSync(adaptDest, { recursive: true });
    for (const f of fs.readdirSync(adaptSrc)) {
      if (f.endsWith(".js")) fs.copyFileSync(path.join(adaptSrc, f), path.join(adaptDest, f));
    }
  }
  // Deploy the descriptions subdirectory — shared.js imports ./descriptions/known.js (OPT-33).
  const descSrc = path.join(HOOKS_SRC, "descriptions");
  if (fs.existsSync(descSrc)) {
    const descDest = path.join(dest, "descriptions");
    fs.mkdirSync(descDest, { recursive: true });
    for (const f of fs.readdirSync(descSrc)) {
      if (f.endsWith(".js")) fs.copyFileSync(path.join(descSrc, f), path.join(descDest, f));
    }
  }
}

function setup(buglogOverrides) {
  fs.rmSync(TESTDIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(TESTDIR, "src"), { recursive: true });
  fs.mkdirSync(path.join(TESTDIR, ".wolf", "hooks"), { recursive: true });
  deployHooks();
  const config = {
    version: 1,
    openwolf: {
      memory: { log_edits: false },
      buglog: { auto_detect: true, max_entries: 200, ...buglogOverrides },
    },
  };
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "config.json"), JSON.stringify(config));
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "anatomy.md"), "# anatomy.md\n\n> Auto-maintained.\n## src/\n- `app.ts` — pre (~10 tok)\n");
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "buglog.json"), JSON.stringify({ version: 1, bugs: [] }));
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "memory.md"), "# Memory\n\n");
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "cerebrum.md"), "# cerebrum\n\n- a\n- b\n- c\n");
  // minimal session so the session-tracker step succeeds (keeps stderr clean)
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "hooks", "_session.json"), JSON.stringify({
    session_id: "dedup-test", started: new Date().toISOString(), files_read: {},
    files_written: [], edit_counts: {}, anatomy_hits: 0, anatomy_misses: 0,
    repeated_reads_warned: 0, cerebrum_warnings: 0, stop_count: 0,
  }));
  fs.writeFileSync(path.join(TESTDIR, "src", "app.ts"), "export const X = 1;\n");
}

function runPostWrite() {
  return spawnSync("node", [path.join(TESTDIR, ".wolf", "hooks", "post-write.js")], {
    cwd: TESTDIR,
    env: { ...process.env, CLAUDE_PROJECT_DIR: TESTDIR },
    input: JSON.stringify({
      tool_name: "Edit",
      tool_input: {
        file_path: path.join(TESTDIR, "src", "app.ts"),
        old_string: "const v = obj.prop",
        new_string: "const v = obj?.prop",
      },
    }),
    encoding: "utf-8",
    timeout: 30000,
  });
}

function readBuglog() {
  return JSON.parse(fs.readFileSync(path.join(TESTDIR, ".wolf", "buglog.json"), "utf-8"));
}

function setLastSeenAgo(minutes) {
  const bl = readBuglog();
  for (const b of bl.bugs) b.last_seen = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "buglog.json"), JSON.stringify(bl));
}

if (!fs.existsSync(HOOKS_SRC)) { console.error("✗ Build missing. Run build:hooks first."); process.exit(2); }

// ── A. default window (no dedup_window_ms) → immediate re-fix dedups ──
{
  setup({});
  let r = runPostWrite();
  assert(r.status === 0, `A: first fix exits 0 — status=${r.status} stderr=${(r.stderr || "").slice(0, 80)}`);
  let bl = readBuglog();
  assert(bl.bugs.length === 1, `A: first fix logs 1 bug (got ${bl.bugs.length})`);
  assert(bl.bugs[0].tags.includes("null-safety"), `A: category null-safety tagged`);
  assert(bl.bugs[0].occurrences === 1, `A: occurrences=1 (got ${bl.bugs[0].occurrences})`);
  r = runPostWrite();
  bl = readBuglog();
  assert(bl.bugs.length === 1, `A: second same-fix dedups (still 1 bug, got ${bl.bugs.length})`);
  assert(bl.bugs[0].occurrences === 2, `A: occurrences=2 (got ${bl.bugs[0].occurrences})`);
}

// ── B. dedup_window_ms: 0 → re-fix does NOT dedup (config override) ──
{
  setup({ dedup_window_ms: 0 });
  let r = runPostWrite();
  assert(r.status === 0, `B: first fix exits 0 — status=${r.status}`);
  let bl = readBuglog();
  assert(bl.bugs.length === 1, `B: first fix logs 1 bug (got ${bl.bugs.length})`);
  r = runPostWrite();
  bl = readBuglog();
  assert(bl.bugs.length === 2, `B: window=0 → no dedup → 2 bugs (got ${bl.bugs.length})`);
}

// ── C. short window (1 min) + old last_seen (30 min ago) → no dedup ──
{
  setup({ dedup_window_ms: 60000 });
  let r = runPostWrite();
  assert(r.status === 0, `C: first fix exits 0 — status=${r.status}`);
  let bl = readBuglog();
  assert(bl.bugs.length === 1, `C: first fix logs 1 bug (got ${bl.bugs.length})`);
  setLastSeenAgo(30); // 30 min ago → outside the 1-min window
  r = runPostWrite();
  bl = readBuglog();
  assert(bl.bugs.length === 2, `C: 30min-old last_seen outside 1min window → new bug (got ${bl.bugs.length})`);
}

// ── D. short window (1 min) + recent last_seen (30 sec ago) → dedup ──
{
  setup({ dedup_window_ms: 60000 });
  let r = runPostWrite();
  assert(r.status === 0, `D: first fix exits 0 — status=${r.status}`);
  setLastSeenAgo(0.5); // 30 sec ago → inside the 1-min window
  r = runPostWrite();
  let bl = readBuglog();
  assert(bl.bugs.length === 1, `D: 30sec-old last_seen inside 1min window → dedup (got ${bl.bugs.length})`);
  assert(bl.bugs[0].occurrences === 2, `D: occurrences=2 (got ${bl.bugs[0].occurrences})`);
}

// ── E. source: dist wired + old 5-min hardcoded window gone ──
{
  const dist = fs.readFileSync(path.join(HOOKS_SRC, "post-write.js"), "utf-8");
  assert(dist.includes("dedup_window_ms"), `dist reads buglog.dedup_window_ms`);
  assert(dist.includes("30 * 60 * 1000"), `dist default window = 30 min`);
  assert(!dist.includes("5 * 60 * 1000"), `dist old 5-min hardcoded window gone`);
  // template exposes the knob (discoverability, consistent with max_entries/max_sessions)
  const tpl = fs.readFileSync(path.join(OPENWOLF_ROOT, "src", "templates", "config.json"), "utf-8");
  assert(tpl.includes('"dedup_window_ms": 1800000'), `config template exposes dedup_window_ms: 1800000`);
}

fs.rmSync(TESTDIR, { recursive: true, force: true });
console.log(`\nG-buglog-dedup-window: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
