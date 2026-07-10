// G-session-start-tmp-cleanup: recursive .tmp cleanup (OPT-38).
// Proves session-start removes stale .tmp files in SUBDIRECTORIES (hooks/, archive/,
// index/), not just the wolfDir root. Before OPT-38 the cleanup was root-only readdir
// and silently left subdir .tmp files (writeJSON creates .tmp beside the target).
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const OPENWOLF_ROOT = path.resolve(import.meta.dirname, "..");
const HOOKS_SRC = path.join(OPENWOLF_ROOT, "dist", "hooks");
const TESTDIR = path.join(OPENWOLF_ROOT, ".session-tmp-cleanup-test");

const CONFIG = {
  version: 1,
  openwolf: { memory: { log_edits: false }, buglog: { auto_detect: false } },
};

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${msg}`);
  }
}

function deployHooks() {
  const dest = path.join(TESTDIR, ".wolf", "hooks");
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(HOOKS_SRC)) {
    const src = path.join(HOOKS_SRC, f);
    if (fs.statSync(src).isFile() && f.endsWith(".js")) {
      fs.copyFileSync(src, path.join(dest, f));
    }
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

function setup() {
  fs.rmSync(TESTDIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(TESTDIR, ".wolf", "hooks"), { recursive: true });
  fs.mkdirSync(path.join(TESTDIR, ".wolf", "archive"), { recursive: true });
  fs.mkdirSync(path.join(TESTDIR, ".wolf", "index"), { recursive: true });
  deployHooks();
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "config.json"), JSON.stringify(CONFIG));
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "anatomy.md"), "# anatomy\n\n");
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "cerebrum.md"), "# cerebrum\n\n- a\n- b\n- c\n");
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "memory.md"), "# Memory\n\n");
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "buglog.json"), JSON.stringify({ version: 1, bugs: [] }));
  // Seed stale .tmp in root + 3 subdirectories (the OPT-38 scenario: writeJSON
  // creates .tmp beside the target, which may be in hooks/, archive/, or index/).
  const seeded = [
    path.join(TESTDIR, ".wolf", "root-stale.tmp"),
    path.join(TESTDIR, ".wolf", "hooks", "_session.json.abc.tmp"),
    path.join(TESTDIR, ".wolf", "archive", "memory-2026-07.def.tmp"),
    path.join(TESTDIR, ".wolf", "index", "retrieval.idx.ghi.tmp"),
  ];
  for (const t of seeded) fs.writeFileSync(t, "stale");
  return seeded;
}

function runSessionStart() {
  return spawnSync("node", [path.join(TESTDIR, ".wolf", "hooks", "session-start.js")], {
    cwd: TESTDIR,
    env: { ...process.env, CLAUDE_PROJECT_DIR: TESTDIR },
    input: JSON.stringify({ session_id: "tmp-cleanup-test" }),
    encoding: "utf-8",
    timeout: 30000,
  });
}

// ── 1. recursive cleanup: all seeded .tmp (root + subdirs) removed ──
const seeded = setup();
const r = runSessionStart();
assert(r.status === 0, `session-start exits 0 — status=${r.status} stderr=${(r.stderr || "").slice(0, 120)}`);
for (const t of seeded) {
  assert(!fs.existsSync(t), `stale .tmp removed: ${path.relative(TESTDIR, t)}`);
}

// ── 2. non-.tmp files preserved (cleanup targets only .tmp) ──
assert(fs.existsSync(path.join(TESTDIR, ".wolf", "config.json")), "config.json preserved (not a .tmp)");
assert(fs.existsSync(path.join(TESTDIR, ".wolf", "buglog.json")), "buglog.json preserved");
assert(fs.existsSync(path.join(TESTDIR, ".wolf", "cerebrum.md")), "cerebrum.md preserved");

// ── 3. nested-subdir .tmp also cleaned (depth > 1, e.g. archive/2026/) ──
fs.rmSync(TESTDIR, { recursive: true, force: true });
fs.mkdirSync(path.join(TESTDIR, ".wolf", "hooks"), { recursive: true });
fs.mkdirSync(path.join(TESTDIR, ".wolf", "archive", "2026", "07"), { recursive: true });
deployHooks();
fs.writeFileSync(path.join(TESTDIR, ".wolf", "config.json"), JSON.stringify(CONFIG));
fs.writeFileSync(path.join(TESTDIR, ".wolf", "cerebrum.md"), "# cerebrum\n\n- a\n- b\n- c\n");
fs.writeFileSync(path.join(TESTDIR, ".wolf", "memory.md"), "# Memory\n\n");
fs.writeFileSync(path.join(TESTDIR, ".wolf", "buglog.json"), JSON.stringify({ version: 1, bugs: [] }));
const deep = path.join(TESTDIR, ".wolf", "archive", "2026", "07", "deep-stale.tmp");
fs.writeFileSync(deep, "stale");
const r2 = runSessionStart();
assert(r2.status === 0, `nested run exits 0 — status=${r2.status} stderr=${(r2.stderr || "").slice(0, 120)}`);
assert(!fs.existsSync(deep), `nested-subdir .tmp removed: ${path.relative(TESTDIR, deep)}`);

// ── 4. source: dist uses recursive readdir (root-only would fail 1+3) ──
const dist = fs.readFileSync(path.join(HOOKS_SRC, "session-start.js"), "utf-8");
assert(dist.includes("recursive: true"), "dist session-start.js uses recursive readdir for .tmp cleanup");
assert(!/\breaddirSync\(wolfDir\)\s*\)/.test(dist), "dist no longer has root-only readdirSync(wolfDir)");

fs.rmSync(TESTDIR, { recursive: true, force: true });
console.log(`\nG-session-start-tmp-cleanup: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
