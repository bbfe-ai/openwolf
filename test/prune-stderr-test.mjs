// G-prune-stderr: prune failures surface to stderr (OPT-10).
//
// Before OPT-10, prune's silent `catch {}` blocks swallowed every failure —
// disk-full / permission / archive errors were invisible. The 03 doc cited
// runPrune's catches, but empirically those are defensive/dead: consolidateMemory,
// buglogCap, ledgerCap catch their OWN archive failures internally (L92/L158/L200)
// and return fail-safe (never drop data) — so the steps never throw and runPrune's
// catches never fire. The REAL silent failures are the internal archive catches.
// Fix: both layers log via warnPruneFailure, preserving the fail-safe return.
//
// Gate: trigger the consolidateMemory archive failure for real (archive dir
// sabotaged as a file → appendFileSync ENOTDIR → L92 catch) and assert stderr
// is written + memory.md is still preserved (fail-safe unchanged). Plus a
// happy-path control (no stderr on success) + a source check that all 6 step
// names landed in the deployed dist.

import { consolidateMemory } from "../dist/hooks/prune.js";
import * as fs from "node:fs";
import * as os from "node:os";
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

// Capture process.stderr.write during fn (the prune code writes failures here).
function captureStderr(fn) {
  let buf = "";
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => { buf += chunk; return true; };
  try { fn(); } finally { process.stderr.write = orig; }
  return buf;
}

const oldDate = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
const oldSession = `## Session: ${oldDate} old\n\n| Time | Action | File(s) | Outcome | ~Tokens |\n|------|--------|---------|---------|--------|\n| 10:00 | edit | old.ts | x | ~10 |`;
const memoryContent = `# Memory\n\n> Auto-maintained by OpenWolf.\n\n` + oldSession + "\n";

// ─── 1. archive failure → stderr + memory preserved (fail-safe) ──
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ow-prune-stderr-fail-"));
  const wolfDir = path.join(tmp, ".wolf");
  fs.mkdirSync(wolfDir, { recursive: true });
  const memPath = path.join(wolfDir, "memory.md");
  fs.writeFileSync(memPath, memoryContent, "utf-8");
  // Sabotage: `archive` is a FILE → appendFileSync(archive/memory-YYYYMM.md) ENOTDIR.
  fs.writeFileSync(path.join(wolfDir, "archive"), "blocker", "utf-8");

  const before = fs.readFileSync(memPath, "utf-8");
  const stderr = captureStderr(() => consolidateMemory(wolfDir, 7, 200));

  assert(stderr.includes("consolidateMemory archive"), `archive failure logged to stderr with step name (got: "${stderr.trim().slice(0, 80)}")`);
  assert(/failed/i.test(stderr), `stderr mentions "failed"`);
  assert(fs.readFileSync(memPath, "utf-8") === before, `memory.md UNCHANGED (fail-safe: never drop detail on archive failure)`);

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ─── 2. happy path (archive succeeds) → NO stderr (not noisy) ──
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ow-prune-stderr-ok-"));
  const wolfDir = path.join(tmp, ".wolf");
  fs.mkdirSync(wolfDir, { recursive: true });
  const memPath = path.join(wolfDir, "memory.md");
  fs.writeFileSync(memPath, memoryContent, "utf-8");
  // No sabotage — archive dir created normally.

  const stderr = captureStderr(() => consolidateMemory(wolfDir, 7, 200));
  const after = fs.readFileSync(memPath, "utf-8");

  assert(stderr === "", `no stderr on successful archive (not noisy; got: "${stderr.trim().slice(0, 80)}")`);
  assert(!after.includes(oldSession), `old session archived out of memory.md on success (proves the run actually did work)`);

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ─── 3. all 6 step names landed in deployed dist (both layers fixed) ──
{
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const dist = fs.readFileSync(path.resolve(__dirname, "..", "dist", "hooks", "prune.js"), "utf-8");
  const names = ["consolidateMemory archive", "buglogCap archive", "ledgerCap archive", "consolidateMemory", "buglogCap", "ledgerCap"];
  for (const n of names) {
    assert(dist.includes(`"${n}"`), `dist has stderr step name "${n}"`);
  }
  assert(dist.includes("warnPruneFailure"), `dist has the warnPruneFailure helper`);
}

console.log(`\nG-prune-stderr: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
