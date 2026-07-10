// T2.3 gate: `openwolf init --agent codex` writes <project>/.codex/hooks.json with
// the 4 codex events (SessionStart / PreToolUse(apply_patch) / PostToolUse(apply_patch)
// / Stop), commands pointing at relative `.wolf/hooks/*.js` (codex spawns hooks with
// cwd = project root — no $CLAUDE_PROJECT_DIR), and commandWindows backslash variants
// for cmd.exe. It must NOT write .claude/settings.json (codex owns its own config).
// The default `--agent claude` path must still write .claude/settings.json unchanged
// (the behavioral no-regression half is G-regress-claude; this asserts the wiring
// is mutually exclusive at the file level).
//
// Run: node test/codex-init-test.mjs
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const OPENWOLF_ROOT = path.resolve(import.meta.dirname, "..");
const BIN = path.join(OPENWOLF_ROOT, "dist", "bin", "openwolf.js");
const TMP_CODEX = path.join(OPENWOLF_ROOT, ".codex-init-test");
const TMP_CLAUDE = path.join(OPENWOLF_ROOT, ".codex-init-test-claude");

let pass = 0, fail = 0;
function assert(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

// pm2 is absent on this host, so the init daemon block no-ops ("pm2 not found").
// projectRoot is anchored by dropping a package.json marker so findProjectRoot()
// resolves the tmp dir itself (not a parent repo root).
function runInit(dir, args) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "codex-init-test" }));
  return spawnSync("node", [BIN, "init", ...args], { cwd: dir, encoding: "utf8" });
}

console.log("── 1. openwolf init --agent codex ──");
const r = runInit(TMP_CODEX, ["--agent", "codex"]);
assert("init --agent codex exits 0", r.status === 0, `status=${r.status}\nstderr:${(r.stderr || "").slice(-500)}`);

const codexHooksPath = path.join(TMP_CODEX, ".codex", "hooks.json");
assert(".codex/hooks.json created", fs.existsSync(codexHooksPath));
assert(".claude/settings.json NOT created (codex owns its own config)",
  !fs.existsSync(path.join(TMP_CODEX, ".claude", "settings.json")));
assert("CLAUDE.md NOT created by codex init",
  !fs.existsSync(path.join(TMP_CODEX, "CLAUDE.md")));

let cfg = null;
try { cfg = JSON.parse(fs.readFileSync(codexHooksPath, "utf8")); }
catch (e) { assert("hooks.json parses", false, String(e)); }

if (cfg) {
  // deny_unknown_fields (hook_config.rs:11) → only 'description'/'hooks' allowed.
  assert("top-level keys subset of {description,hooks}", Object.keys(cfg).every(k => k === "hooks" || k === "description"), `got ${Object.keys(cfg)}`);
  const ev = cfg.hooks || {};
  const events = Object.keys(ev).sort();
  assert("exactly 4 events", JSON.stringify(events) === JSON.stringify(["PostToolUse", "PreToolUse", "SessionStart", "Stop"].sort()), `got ${events.join(",")}`);
  assert("PreToolUse matcher = apply_patch", ev.PreToolUse?.[0]?.matcher === "apply_patch", `got ${ev.PreToolUse?.[0]?.matcher}`);
  assert("PostToolUse matcher = apply_patch", ev.PostToolUse?.[0]?.matcher === "apply_patch", `got ${ev.PostToolUse?.[0]?.matcher}`);
  assert("SessionStart matcher = ''", ev.SessionStart?.[0]?.matcher === "", `got ${ev.SessionStart?.[0]?.matcher}`);
  assert("Stop matcher = ''", ev.Stop?.[0]?.matcher === "", `got ${ev.Stop?.[0]?.matcher}`);

  const expect = {
    SessionStart: { file: "session-start.js", to: 5 },
    PreToolUse: { file: "pre-write.js", to: 5 },
    PostToolUse: { file: "post-write.js", to: 10 },
    Stop: { file: "stop.js", to: 10 },
  };
  for (const [evName, ex] of Object.entries(expect)) {
    const h = ev[evName]?.[0]?.hooks?.[0];
    assert(`${evName} type=command`, h?.type === "command", `got ${h?.type}`);
    assert(`${evName} command -> relative .wolf/hooks/${ex.file}`, h?.command === `node .wolf/hooks/${ex.file}`, `got ${h?.command}`);
    assert(`${evName} commandWindows -> backslash .wolf\\hooks\\${ex.file}`, h?.commandWindows === `node .wolf\\hooks\\${ex.file}`, `got ${h?.commandWindows}`);
    assert(`${evName} timeout=${ex.to}`, h?.timeout === ex.to, `got ${h?.timeout}`);
    assert(`${evName} command has NO $CLAUDE_PROJECT_DIR (codex has no such var)`, !(h?.command || "").includes("CLAUDE_PROJECT_DIR"));
  }
}

console.log("── 2. hooks deployed to .wolf/hooks/ (codex reuses same scripts) ──");
const hooksDir = path.join(TMP_CODEX, ".wolf", "hooks");
for (const f of ["session-start.js", "pre-write.js", "post-write.js", "stop.js", "shared.js", "adapters/normalize.js", "adapters/codex-v4a.js"]) {
  assert(`.wolf/hooks/${f} deployed`, fs.existsSync(path.join(hooksDir, f)), `missing ${f}`);
}
assert(".wolf/hooks/package.json (type:module) deployed", JSON.parse(fs.readFileSync(path.join(hooksDir, "package.json"), "utf8")).type === "module");

console.log("── 3. default --agent claude still writes .claude/settings.json ──");
const rc = runInit(TMP_CLAUDE, []);
assert("init (default claude) exits 0", rc.status === 0, `status=${rc.status}\nstderr:${(rc.stderr || "").slice(-500)}`);
assert(".claude/settings.json created (default claude path intact)", fs.existsSync(path.join(TMP_CLAUDE, ".claude", "settings.json")));
assert(".codex/hooks.json NOT created by default claude init", !fs.existsSync(path.join(TMP_CLAUDE, ".codex", "hooks.json")));
const claudeCfg = JSON.parse(fs.readFileSync(path.join(TMP_CLAUDE, ".claude", "settings.json"), "utf8"));
assert("claude settings has SessionStart/PreToolUse/PostToolUse/Stop",
  ["SessionStart", "PreToolUse", "PostToolUse", "Stop"].every(e => claudeCfg.hooks?.[e]));
assert("claude PreToolUse command uses $CLAUDE_PROJECT_DIR (claude path, not codex)",
  claudeCfg.hooks?.PreToolUse?.[0]?.hooks?.[0]?.command?.includes("CLAUDE_PROJECT_DIR"));

// cleanup
fs.rmSync(TMP_CODEX, { recursive: true, force: true });
fs.rmSync(TMP_CLAUDE, { recursive: true, force: true });

console.log(`\n${fail === 0 ? "ALL GREEN" : `${fail} FAILED`} (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
