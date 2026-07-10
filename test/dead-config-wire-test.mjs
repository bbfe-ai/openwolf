// G-dead-config-wire: wire two dead config knobs (OPT-28 + OPT-29).
//
// OPT-28: anatomy.max_description_length was dead — post-write hardcoded
// .slice(0, 100). Now wired (default 100).
// OPT-29: token_audit.chars_per_token_{code,prose} were dead — estimateTokens
// hardcoded 3.5 / 4.0. Now wired (mixed = average of the two; default 3.5/4.0).
//
// Gate: run post-write under different configs, parse the anatomy.md entry for
// app.ts, assert (OPT-28) description length honors max_description_length and
// (OPT-29) the ~N tok count honors chars_per_token_code. Each scenario runs in a
// fresh process (readConfig cache is per-process, so no carryover).

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const OPENWOLF_ROOT = path.resolve(import.meta.dirname, "..");
const HOOKS_SRC = path.join(OPENWOLF_ROOT, "dist", "hooks");
const TESTDIR = path.join(OPENWOLF_ROOT, ".dead-config-test");

const APP_TS = "/** This is a long description exceeding ten chars */\nexport const VALUE = 1234567890;\n";

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
}

function setup(openwolfOverrides) {
  fs.rmSync(TESTDIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(TESTDIR, "src"), { recursive: true });
  fs.mkdirSync(path.join(TESTDIR, ".wolf", "hooks"), { recursive: true });
  deployHooks();
  const config = {
    version: 1,
    openwolf: {
      memory: { log_edits: false },
      buglog: { auto_detect: false },
      ...openwolfOverrides,
    },
  };
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "config.json"), JSON.stringify(config));
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "anatomy.md"), "# anatomy.md\n\n> Auto-maintained.\n## src/\n");
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "buglog.json"), JSON.stringify({ version: 1, bugs: [] }));
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "memory.md"), "# Memory\n\n");
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "cerebrum.md"), "# cerebrum\n\n- a\n- b\n- c\n");
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "hooks", "_session.json"), JSON.stringify({
    session_id: "dead-config-test", started: new Date().toISOString(), files_read: {},
    files_written: [], edit_counts: {}, anatomy_hits: 0, anatomy_misses: 0,
    repeated_reads_warned: 0, cerebrum_warnings: 0, stop_count: 0,
  }));
  fs.writeFileSync(path.join(TESTDIR, "src", "app.ts"), APP_TS);
}

function runPostWrite() {
  return spawnSync("node", [path.join(TESTDIR, ".wolf", "hooks", "post-write.js")], {
    cwd: TESTDIR,
    env: { ...process.env, CLAUDE_PROJECT_DIR: TESTDIR },
    input: JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: path.join(TESTDIR, "src", "app.ts"), old_string: "VALUE = 1234567890", new_string: "VALUE = 123456789" },
    }),
    encoding: "utf-8",
    timeout: 30000,
  });
}

// Parse the app.ts anatomy entry → { desc, tokens }. Format: `- `app.ts` — desc (~N tok)`
function anatomyEntry() {
  const md = fs.readFileSync(path.join(TESTDIR, ".wolf", "anatomy.md"), "utf-8");
  const line = md.split("\n").find((l) => l.startsWith("- `app.ts`"));
  if (!line) return null;
  const m = line.match(/^(?:.+?)\s+—\s+(.+?)\s+\(~(\d+)\s+tok\)$/);
  if (!m) return null;
  return { desc: m[1], tokens: parseInt(m[2], 10) };
}

if (!fs.existsSync(HOOKS_SRC)) { console.error("✗ Build missing. Run build:hooks first."); process.exit(2); }

const fileLen = Buffer.byteLength(APP_TS, "utf-8");
// estimateTokens uses text.length (UTF-16 code units); for ASCII content == byte length.
const charLen = APP_TS.length;

// ── OPT-28: max_description_length honored ──
// extractDescription returns "This is a long description exceeding ten chars" (46).
// "long" starts at index 10, so slice(0,10) excludes it; the full desc includes it.
{
  setup({ anatomy: { max_description_length: 10 } });
  const r = runPostWrite();
  assert(r.status === 0, `OPT-28: post-write exits 0 — status=${r.status} stderr=${(r.stderr || "").slice(0, 80)}`);
  const md = fs.readFileSync(path.join(TESTDIR, ".wolf", "anatomy.md"), "utf-8");
  const line = md.split("\n").find((l) => l.startsWith("- `app.ts`"));
  assert(!!line, `OPT-28: anatomy entry for app.ts exists`);
  assert(line && !line.includes("long"), `OPT-28: desc truncated to 10 (no "long") — got: ${line}`);
}
{
  setup({}); // default (no max_description_length → 100)
  const r = runPostWrite();
  assert(r.status === 0, `OPT-28 default: post-write exits 0 — status=${r.status}`);
  const e = anatomyEntry();
  assert(e && e.desc.length === 46, `OPT-28 default: desc not truncated (full 46 chars) — got len ${e?.desc.length}`);
}

// ── OPT-29: chars_per_token_code honored ──
{
  setup({ token_audit: { chars_per_token_code: 7 } });
  const r = runPostWrite();
  assert(r.status === 0, `OPT-29 code=7: post-write exits 0 — status=${r.status} stderr=${(r.stderr || "").slice(0, 80)}`);
  const e = anatomyEntry();
  const expected = Math.ceil(charLen / 7);
  assert(e && e.tokens === expected, `OPT-29 code=7: tokens = ceil(${charLen}/7) = ${expected} — got ${e?.tokens}`);
}
{
  setup({}); // default (no chars_per_token_code → 3.5)
  const r = runPostWrite();
  assert(r.status === 0, `OPT-29 default: post-write exits 0 — status=${r.status}`);
  const e = anatomyEntry();
  const expected = Math.ceil(charLen / 3.5);
  assert(e && e.tokens === expected, `OPT-29 default: tokens = ceil(${charLen}/3.5) = ${expected} — got ${e?.tokens}`);
}

// ── OPT-29: chars_per_token_prose honored (prose file) ──
{
  // .md file → type "prose" → proseRatio
  fs.rmSync(TESTDIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(TESTDIR, "src"), { recursive: true });
  fs.mkdirSync(path.join(TESTDIR, ".wolf", "hooks"), { recursive: true });
  deployHooks();
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "config.json"), JSON.stringify({
    version: 1, openwolf: { memory: { log_edits: false }, buglog: { auto_detect: false }, token_audit: { chars_per_token_prose: 5 } },
  }));
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "anatomy.md"), "# anatomy.md\n\n> Auto-maintained.\n## src/\n");
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "buglog.json"), JSON.stringify({ version: 1, bugs: [] }));
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "memory.md"), "# Memory\n\n");
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "cerebrum.md"), "# cerebrum\n\n- a\n- b\n- c\n");
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "hooks", "_session.json"), JSON.stringify({
    session_id: "dead-config-test", started: new Date().toISOString(), files_read: {},
    files_written: [], edit_counts: {}, anatomy_hits: 0, anatomy_misses: 0,
    repeated_reads_warned: 0, cerebrum_warnings: 0, stop_count: 0,
  }));
  const PROSE = "# Title\n\nThis is some prose content for testing token estimation.\n";
  fs.writeFileSync(path.join(TESTDIR, "src", "notes.md"), PROSE);
  const r = spawnSync("node", [path.join(TESTDIR, ".wolf", "hooks", "post-write.js")], {
    cwd: TESTDIR,
    env: { ...process.env, CLAUDE_PROJECT_DIR: TESTDIR },
    input: JSON.stringify({ tool_name: "Edit", tool_input: { file_path: path.join(TESTDIR, "src", "notes.md"), old_string: "Title", new_string: "Title2" } }),
    encoding: "utf-8", timeout: 30000,
  });
  assert(r.status === 0, `OPT-29 prose=5: post-write exits 0 — status=${r.status}`);
  const md = fs.readFileSync(path.join(TESTDIR, ".wolf", "anatomy.md"), "utf-8");
  const line = md.split("\n").find((l) => l.startsWith("- `notes.md`"));
  const m = line && line.match(/\(~(\d+)\s+tok\)$/);
  const expected = Math.ceil(PROSE.length / 5);
  assert(m && parseInt(m[1], 10) === expected, `OPT-29 prose=5: tokens = ceil(${PROSE.length}/5) = ${expected} — got ${m?.[1]}`);
}

// ── source: both knobs wired in dist ──
{
  const pw = fs.readFileSync(path.join(HOOKS_SRC, "post-write.js"), "utf-8");
  assert(pw.includes("max_description_length") && pw.includes("maxDescLen"), `OPT-28: dist post-write.js reads max_description_length`);
  const sh = fs.readFileSync(path.join(HOOKS_SRC, "shared.js"), "utf-8");
  assert(sh.includes("chars_per_token_code") && sh.includes("chars_per_token_prose"), `OPT-29: dist shared.js reads chars_per_token_{code,prose}`);
  assert(sh.includes("(codeRatio + proseRatio) / 2"), `OPT-29: mixed = average of code + prose ratios`);
}

fs.rmSync(TESTDIR, { recursive: true, force: true });
console.log(`\nG-dead-config-wire: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
