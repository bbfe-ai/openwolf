// G-template-content: template overhaul gate (OPT-39 / OPT-40 / OPT-41 / OPT-42).
//
// src/templates/ ships in the npm package (package.json files: ["dist/",
// "src/templates/", ...]) and findTemplatesDir always resolves it (dev + npm
// install), so these FILES are the deploy source — init.ts writeTemplateFile
// and update.ts both copyFileSync/readFileSync them verbatim. Asserting source
// content == asserting deployed content (the copy is byte-identical).
//
// Each assertion has a positive (new content present) + negative (old
// low-threshold / MANDATORY phrasing gone) check. The negative checks are the
// false-green guard: a missed edit leaves the old phrase and fails the gate.
//
// OPT-42 deviation (Simplicity First): the 03 doc's `hooks` section
// (auto_bug_detection / edit_count_warning_threshold / prune) is NOT added —
// grep confirmed no code reads `openwolf.hooks.*` (all `.hooks` hits are
// .claude/settings.json hook arrays). Adding unread config is dead config.
// Instead `ledger.max_sessions` IS added — read by runPrune (OPT-9), makes the
// cap discoverable, mirrors the existing `buglog.max_entries` pattern.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${msg}`);
  } else {
    fail++;
    console.error(`  ✗ ${msg}`);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(__dirname, "..", "src", "templates");
assert(fs.existsSync(dir), `src/templates/ exists (deploy source)`);

// ─── OPT-39: claude-md-snippet.md → 按需查阅, drop eager @-import ──
{
  const c = fs.readFileSync(path.join(dir, "claude-md-snippet.md"), "utf-8");
  assert(c.includes("<!-- openwolf:v2 -->"), `snippet has v2 marker`);
  assert(c.includes("按需查阅"), `snippet: 按需查阅 (on-demand) present`);
  assert(!c.includes("Read and follow .wolf/OPENWOLF.md every session"), `snippet: old "Read and follow every session" gone`);
  assert(!c.includes("@.wolf/OPENWOLF.md"), `snippet: eager @.wolf/OPENWOLF.md import dropped (was 6.8KB/session auto-load)`);
}

// ─── OPT-40: claude-rules-openwolf.md → selective, not mandatory ──
{
  const c = fs.readFileSync(path.join(dir, "claude-rules-openwolf.md"), "utf-8");
  assert(c.includes("<!-- openwolf:v2 -->"), `rules: v2 marker`);
  assert(c.includes("不强制"), `rules: 不强制 (not mandatory) present`);
  assert(c.includes("context governance — selective, not mandatory"), `rules: new description (selective governance)`);
  assert(!c.includes("Low threshold"), `rules: old "Low threshold" gone`);
  assert(!c.includes("If you edit a file more than twice"), `rules: old "edit twice = bug" false-positive trigger gone`);
  assert(!c.includes("protocol enforcement"), `rules: old "protocol enforcement" description gone`);
}

// ─── OPT-41: OPENWOLF.md → drop MANDATORY / low-bar / edit-twice ──
{
  const c = fs.readFileSync(path.join(dir, "OPENWOLF.md"), "utf-8");
  assert(c.includes("<!-- openwolf:v2 -->"), `OPENWOLF: v2 marker`);
  assert(!c.includes("MANDATORY"), `OPENWOLF: "MANDATORY" gone (was Cerebrum Learning + Bug Logging headings)`);
  assert(!c.includes("apply every turn"), `OPENWOLF: "apply every turn" → "apply when you interact with .wolf files"`);
  assert(!c.includes("The bar is LOW"), `OPENWOLF: cerebrum "The bar is LOW" → durable-and-reusable`);
  assert(!c.includes("The threshold is LOW"), `OPENWOLF: buglog "The threshold is LOW" → real-bugs-only`);
  assert(!c.includes("You MUST update"), `OPENWOLF: "You MUST update cerebrum" softened`);
  assert(!c.includes("edit a file more than twice"), `OPENWOLF: "edit twice" bug trigger removed`);
  assert(c.includes("optional and config-gated"), `OPENWOLF: memory.md logging now optional/config-gated`);
}

// ─── OPT-42: config.json → add ledger (read by runPrune); no dead hooks ──
{
  const raw = fs.readFileSync(path.join(dir, "config.json"), "utf-8");
  let cfg;
  try {
    cfg = JSON.parse(raw);
    assert(true, `config.json: valid JSON`);
  } catch (e) {
    assert(false, `config.json: valid JSON (${e.message})`);
    cfg = {};
  }
  assert(cfg.openwolf?.ledger?.max_sessions === 200, `config.json: openwolf.ledger.max_sessions === 200 (read by runPrune, OPT-9)`);
  assert(cfg.openwolf?.buglog?.auto_detect === false, `config.json: buglog.auto_detect === false (preserved)`);
  assert(cfg.openwolf?.buglog?.max_entries === 200, `config.json: buglog.max_entries === 200 (preserved)`);
  assert(cfg.openwolf?.hooks === undefined, `config.json: NO dead \`hooks\` section (no code reads openwolf.hooks.*; Simplicity First)`);
}

console.log(`\nG-template-content: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
