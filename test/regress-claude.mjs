// G-regress-claude: Claude Code path regression gate (initiative 11, C1 zero-regression).
//
// Reproduces the exact workload of initiative-10's A/B test (session-start + 20 edits
// + stop) on the CURRENT openwolf build, and asserts the Claude path still behaves:
//   - memory.md does NOT grow when gating is OFF (default)
//   - buglog.json does NOT grow (auto_detect OFF default)
//   - stop triggers prune (no daemon): old session block archived lossless
//   - `openwolf search` hits cerebrum, never anatomy
//
// This is the gate that every adapter task must NOT break. Baseline values are
// hard-coded below; if they drift, the gate fails loudly (PASS/FAIL per assertion),
// not just exit 0.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const OPENWOLF_ROOT = path.resolve(import.meta.dirname, "..");
const HOOKS = path.join(OPENWOLF_ROOT, "dist", "hooks");
const BIN = path.join(OPENWOLF_ROOT, "dist", "bin", "openwolf.js");
const TESTDIR = path.join(OPENWOLF_ROOT, ".regress-claude");

// Identical initial fixtures to initiative-10's A/B test.
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

// v1.1.0 default config: gating OFF (the upgrade's core behavior). v1.0.4 had no
// gating fields (unconditional append) — this config is what makes the assertions hold.
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
  // Deploy the adapter subdirectory too — shared.js imports ./adapters/normalize.js
  // (initiative 11). Without this the hooks fail to load (ERR_MODULE_NOT_FOUND)
  // and every assertion becomes a false positive.
  const adaptSrc = path.join(HOOKS, "adapters");
  const adaptDst = path.join(TESTDIR, ".wolf", "hooks", "adapters");
  if (fs.existsSync(adaptSrc)) {
    fs.mkdirSync(adaptDst, { recursive: true });
    for (const f of fs.readdirSync(adaptSrc)) {
      if (f.endsWith(".js")) fs.copyFileSync(path.join(adaptSrc, f), path.join(adaptDst, f));
    }
  }
  // Deploy the descriptions subdirectory too — shared.js imports ./descriptions/known.js
  // (OPT-33). readdirSync so per-family modules added later are picked up automatically.
  const descSrc = path.join(HOOKS, "descriptions");
  const descDst = path.join(TESTDIR, ".wolf", "hooks", "descriptions");
  if (fs.existsSync(descSrc)) {
    fs.mkdirSync(descDst, { recursive: true });
    for (const f of fs.readdirSync(descSrc)) {
      if (f.endsWith(".js")) fs.copyFileSync(path.join(descSrc, f), path.join(descDst, f));
    }
  }
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "config.json"), JSON.stringify(CONFIG));
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "anatomy.md"), "# anatomy.md\n\n> Auto-maintained.\n## BuildKit\n- \`src/app.ts\` — main app (~50 tok)\n");
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "cerebrum.md"),
    "# cerebrum.md\n\n## BuildKit\n- BuildKit cache invalidation: prune dangling layers weekly\n- BuildKit mount type=cache must be scoped per-project\n");
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "memory.md"), INITIAL_MEMORY);
  fs.writeFileSync(path.join(TESTDIR, ".wolf", "buglog.json"), JSON.stringify({ version: 1, bugs: [] }));
  fs.writeFileSync(path.join(TESTDIR, "src", "app.ts"), 'export function greet(name) {\n  return "hello " + name;\n}\n');
}

function runHook(hookName, input) {
  const r = spawnSync("node", [path.join(TESTDIR, ".wolf", "hooks", hookName)], {
    cwd: TESTDIR, env: { ...process.env, CLAUDE_PROJECT_DIR: TESTDIR },
    input: JSON.stringify(input), encoding: "utf-8", timeout: 30000,
  });
  return r;
}

function runBin(args) {
  const r = spawnSync("node", [BIN, ...args], {
    cwd: TESTDIR, env: { ...process.env, CLAUDE_PROJECT_DIR: TESTDIR },
    encoding: "utf-8", timeout: 30000,
  });
  return r;
}

// ─── run ───
if (!exists(HOOKS) || !exists(BIN)) {
  console.error("✗ Build missing. Run `pnpm build` first."); process.exit(2);
}

const MODE = process.argv[2]; // undefined = assert; "--snapshot" = write baseline json
setup();
runHook("session-start.js", { session_id: "regress-claude" });
for (const e of EDITS) {
  runHook("post-write.js", {
    tool_name: "Edit",
    tool_input: { file_path: path.join(TESTDIR, "src", "app.ts"), old_string: e.old, new_string: e.new },
  });
}
runHook("stop.js", {});

const mem = fs.readFileSync(path.join(TESTDIR, ".wolf", "memory.md"), "utf-8");
const memBlocks = (mem.match(/^## Session: /gm) || []).length;
const memRows = tableRows(mem);
const bugN = bugCount(path.join(TESTDIR, ".wolf", "buglog.json"));
const archiveExists = exists(path.join(TESTDIR, ".wolf", "archive", "memory-2026-07.md"));
const searchOut = runBin(["search", "BuildKit"]).stdout;
const searchAnatomy = runBin(["search", "--file", "anatomy", "BuildKit"]);

// T0.2: baseline snapshot — frozen state for future G2 zero-diff comparison.
// Captures file sizes + structural counts after the canonical workload. Re-running
// `node test/regress-claude.mjs --snapshot` must yield byte-identical values while
// no contract change is approved.
if (MODE === "--snapshot") {
  const baseline = {
    generated_for: "claude",
    workload: { session_starts: 1, edits: EDITS.length, stops: 1 },
    anatomy_bytes: fs.statSync(path.join(TESTDIR, ".wolf", "anatomy.md")).size,
    cerebrum_bytes: fs.statSync(path.join(TESTDIR, ".wolf", "cerebrum.md")).size,
    memory_bytes: fs.statSync(path.join(TESTDIR, ".wolf", "memory.md")).size,
    memory_blocks: memBlocks,
    memory_rows: memRows,
    buglog_bytes: fs.statSync(path.join(TESTDIR, ".wolf", "buglog.json")).size,
    buglog_count: bugN,
    archive_exists: archiveExists,
    index_exists: exists(path.join(TESTDIR, ".wolf", "index", "wolf-index.json")),
    search_returns_cerebrum: searchOut.includes("cerebrum.md"),
  };
  const outDir = path.join(import.meta.dirname, "baselines");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, "claude.json");
  const prev = exists(out) ? fs.readFileSync(out, "utf-8") : null;
  fs.writeFileSync(out, JSON.stringify(baseline, null, 2) + "\n");
  fs.rmSync(TESTDIR, { recursive: true, force: true });
  console.log(`baseline written: ${out}`);
  if (prev !== null && prev !== JSON.stringify(baseline, null, 2) + "\n") {
    console.error("✗ BASELINE DRIFT — claude.json changed without an approved contract change.");
    process.exit(1);
  }
  process.exit(0);
}

// ─── assertions (hard-coded baseline = C1 zero-regression gate) ───
console.log("\nG-regress-claude assertions:");
assert("memory.md no growth (gating OFF): only recent session block remains", memBlocks === 1, `got ${memBlocks} blocks`);
assert("memory.md table rows not grown by 20 edits", memRows === 1, `got ${memRows} rows`);
assert("buglog.json no false positives (auto_detect OFF)", bugN === 0, `got ${bugN} bugs`);
assert("stop triggered prune without daemon", archiveExists, "archive/memory-2026-07.md missing");
assert("prune archived old session lossless", archiveExists && fs.readFileSync(path.join(TESTDIR, ".wolf", "archive", "memory-2026-07.md"), "utf-8").includes("2020-01-15"));
assert("search hits cerebrum", searchOut.includes("cerebrum.md"), "no cerebrum hit");
assert("search does NOT read whole file hint", searchOut.includes("do not read the whole file"));
assert("anatomy excluded from search (--file anatomy rejected)", searchAnatomy.stderr.includes("anatomy.md is fully injected") || searchAnatomy.stdout.includes("anatomy.md is fully injected"));

console.log(`\n${fail === 0 ? "ALL GREEN" : `${fail} FAILED`} (${pass} passed)`);
// cleanup
fs.rmSync(TESTDIR, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
