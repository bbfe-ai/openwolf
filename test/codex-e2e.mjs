// T2.5 (b) G-codex-e2e: full Codex session end-to-end gate (initiative 11).
//
// Mirrors regress-claude.mjs's canonical workload (SessionStart + 20 edits + Stop)
// but feeds Codex PostToolUse apply_patch envelopes instead of Claude Edit events.
// Proves the WHOLE codex path empirically — not just the post-write seam (covered by
// codex-postwrite-smoke.mjs) but also Stop-triggered prune + search→cerebrum /
// anatomy-excluded, run against .wolf/ state populated by codex events.
//
// Why a full e2e and not "stop/search are agent-agnostic, see G-regress-claude":
// the user's standing preference is empirical runs over transitive arguments. stop.js
// and `openwolf search` are agent-agnostic in CODE, but their INPUTS (the _session.json
// + anatomy.md written by the codex-driven post-write) are produced by the new seam —
// so running them end-to-end against codex-populated state is the non-false-green proof
// that the seam's output is consumable by the rest of the pipeline.
//
// Run: node test/codex-e2e.mjs
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const OPENWOLF_ROOT = path.resolve(import.meta.dirname, "..");
const HOOKS = path.join(OPENWOLF_ROOT, "dist", "hooks");
const BIN = path.join(OPENWOLF_ROOT, "dist", "bin", "openwolf.js");
const TESTDIR = path.join(OPENWOLF_ROOT, ".codex-e2e");

// Identical fixtures to regress-claude.mjs (initiative-10 A/B workload) so prune has
// an old session block to archive and search has cerebrum content to hit.
const INITIAL_MEMORY = `# Memory

> Auto-maintained by OpenWolf.

## Session: 2020-01-15 10:00

| Time | Action | File(s) | Outcome | ~Tokens |
|------|--------|---------|---------|--------|
| 2020-01-15 10:00 | Edited src/legacy.ts | legacy cache fix | ~100 |
| 2020-01-15 10:05 | Edited src/legacy.ts | tweak timeout | ~50 |

## Session: 2026-07-09 14:00

| Time | Action | File(s) | Outcome | ~Tokens |
|------|--------|---------|---------|--------|
| 2026-07-09 14:00 | Edited src/recent.ts | recent change | ~80 |
`;

const EDITS = [
  { old: `function f() { return x; }`, new: `function f() { try { return x; } catch (e) { return null; } }` },
  { old: `return user.name;`, new: `return user?.name;` },
  { old: `function f(x) { return x; }`, new: `function f(x) { if (!x) return null; return x; }` },
  { old: `const url = "http://old";`, new: `const url = "http://new";` },
  { old: `return getValue();`, new: `return getFoo();` },
  { old: `if (x > 10) { doThing(); }`, new: `if (x > 5) { doThing(); }` },
  { old: `const eq = a === b;`, new: `const eq = a !== b;` },
  { old: `function f() { return 1; }`, new: `import { x } from "y";\nfunction f() { return 1; }` },
  { old: `function f() { return 1; }`, new: `function f() { return 2; }` },
  { old: `const f = () => x;`, new: `const f = async () => await x;` },
  { old: `const x = getValue();`, new: `const x = getValue() as string;` },
  { old: `function f() {\n  doA();\n  doB();\n  doC();\n}`, new: `function f() {\n  doX();\n  doY();\n}` },
  { old: `function g() { return y; }`, new: `function g() { try { return y; } catch (e) { return null; } }` },
  { old: `return profile.email;`, new: `return profile?.email;` },
  { old: `function h(x) { return x; }`, new: `function h(x) { if (!x) return null; return x; }` },
  { old: `const port = "3000";`, new: `const port = "8080";` },
  { old: `return loadConfig();`, new: `return loadSettings();` },
  { old: `if (n > 100) { run(); }`, new: `if (n > 50) { run(); }` },
  { old: `const ok = a === b;`, new: `const ok = a !== b;` },
  { old: `const g = () => y;`, new: `const g = async () => await y;` },
];

const CONFIG = {
  version: 1,
  memory: { log_edits: false, consolidation_after_days: 7, max_entries_before_consolidation: 200 },
  buglog: { auto_detect: false, max_entries: 200 },
};

let pass = 0, fail = 0;
function assert(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}
const tableRows = s => s.split("\n").filter(l => l.startsWith("|") && !l.startsWith("|--") && !l.startsWith("| Time") && !l.startsWith("|------")).length;
const bugCount = p => { try { return JSON.parse(fs.readFileSync(p, "utf-8")).bugs.length; } catch { return -1; } };
const exists = p => fs.existsSync(p);

function setup() {
  fs.rmSync(TESTDIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(TESTDIR, "src"), { recursive: true });
  fs.mkdirSync(path.join(TESTDIR, ".wolf", "hooks"), { recursive: true });
  for (const f of fs.readdirSync(HOOKS)) {
    if (f.endsWith(".js")) fs.copyFileSync(path.join(HOOKS, f), path.join(TESTDIR, ".wolf", "hooks", f));
  }
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
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "anatomy.md"), "# anatomy.md\n\n> Auto-maintained.\n## BuildKit\n- `src/app.ts` — main app (~50 tok)\n");
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "cerebrum.md"),
    "# cerebrum.md\n\n## BuildKit\n- BuildKit cache invalidation: prune dangling layers weekly\n- BuildKit mount type=cache must be scoped per-project\n");
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "memory.md"), INITIAL_MEMORY);
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "buglog.json"), JSON.stringify({ version: 1, bugs: [] }));
  fs.writeFileSync(path.join(TESTDIR, "src", "app.ts"), 'export function greet(name) {\n  return "hello " + name;\n}\n');
}

// Codex hook environment: cwd=project root, NO CLAUDE_PROJECT_DIR (codex injects 0 env
// vars for project hooks — verified Q1/Q3). Hook resolves .wolf/ via process.cwd().
function runHook(hookName, input) {
  const r = spawnSync("node", [path.join(TESTDIR, ".wolf", "hooks", hookName)], {
    cwd: TESTDIR, env: { ...process.env /* NO CLAUDE_PROJECT_DIR — codex path */ },
    input: JSON.stringify(input), encoding: "utf-8", timeout: 30000,
  });
  return r;
}
function runBin(args) {
  return spawnSync("node", [BIN, ...args], {
    cwd: TESTDIR, env: { ...process.env, CLAUDE_PROJECT_DIR: TESTDIR },
    encoding: "utf-8", timeout: 30000,
  });
}

// Wrap a claude-shape {old,new} edit as a Codex apply_patch V4A command. Each line of
// old → "-" prefix, each line of new → "+" prefix (no context anchors needed — none
// of the 20 edits have lines starting with -/+/space, verified).
function toV4A(oldStr, newStr) {
  const oldLines = oldStr.split("\n").map(l => "-" + l).join("\n");
  const newLines = newStr.split("\n").map(l => "+" + l).join("\n");
  return `*** Begin Patch\n*** Update File: src/app.ts\n${oldLines}\n${newLines}\n*** End Patch`;
}
function codexPostEnv(command) {
  return {
    session_id: "s1", turn_id: "t1", cwd: TESTDIR.replace(/\\/g, "/"),
    hook_event_name: "PostToolUse", model: "gpt-5-codex", permission_mode: "default",
    tool_name: "apply_patch", tool_input: { command }, tool_use_id: "call_1",
  };
}
// Codex SessionStart envelope (session-start.js reads stdin for the OPT-37
// total_sessions dedup — writes _session.json via ensureWolfDir/getWolfDir;
// we feed a codex-shaped envelope for fidelity, session_id "s1" is counted once).
function codexStartEnv() {
  return {
    session_id: "s1", turn_id: "t0", cwd: TESTDIR.replace(/\\/g, "/"),
    hook_event_name: "SessionStart", model: "gpt-5-codex", permission_mode: "default",
  };
}

// ── run ──
if (!exists(HOOKS) || !exists(BIN)) {
  console.error("✗ Build missing. Run `pnpm build` (bin) + `pnpm build:hooks` first."); process.exit(2);
}

setup();
runHook("session-start.js", codexStartEnv());
for (const e of EDITS) {
  runHook("post-write.js", codexPostEnv(toV4A(e.old, e.new)));
}
runHook("stop.js", {});

const mem = fs.readFileSync(path.join(TESTDIR, ".wolf", "memory.md"), "utf-8");
const memBlocks = (mem.match(/^## Session: /gm) || []).length;
const memRows = tableRows(mem);
const bugN = bugCount(path.join(TESTDIR, ".wolf", "buglog.json"));
const archiveExists = exists(path.join(TESTDIR, ".wolf", "archive", "memory-2026-07.md"));
const searchOut = runBin(["search", "BuildKit"]).stdout;
const searchAnatomy = runBin(["search", "--file", "anatomy", "BuildKit"]);
const anatomy = fs.readFileSync(path.join(TESTDIR, ".wolf", "anatomy.md"), "utf-8");

console.log("\nG-codex-e2e assertions:");
assert("memory.md no growth (gating OFF): only recent session block remains", memBlocks === 1, `got ${memBlocks} blocks`);
assert("memory.md table rows not grown by 20 codex edits", memRows === 1, `got ${memRows} rows`);
assert("buglog.json no false positives (auto_detect OFF) for codex path", bugN === 0, `got ${bugN} bugs`);
assert("stop triggered prune without daemon (codex session)", archiveExists, "archive/memory-2026-07.md missing");
assert("prune archived old session lossless (codex session)", archiveExists && fs.readFileSync(path.join(TESTDIR, ".wolf", "archive", "memory-2026-07.md"), "utf-8").includes("2020-01-15"));
assert("search hits cerebrum (codex-populated .wolf/)", searchOut.includes("cerebrum.md"), "no cerebrum hit");
assert("search does NOT read whole file hint", searchOut.includes("do not read the whole file"));
assert("anatomy excluded from search (--file anatomy rejected)", searchAnatomy.stderr.includes("anatomy.md is fully injected") || searchAnatomy.stdout.includes("anatomy.md is fully injected"));
assert("anatomy gained src/app.ts (V4A file_path flowed through 20 codex edits)", anatomy.includes("app.ts"), "anatomy has no app.ts");

console.log(`\n${fail === 0 ? "ALL GREEN" : `${fail} FAILED`} (${pass} passed)`);
fs.rmSync(TESTDIR, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
