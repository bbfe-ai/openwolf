// G-claude-md-idempotency: CLAUDE.md snippet v2 marker + legacy upgrade (OPT-43).
//
// Before OPT-43, init/update checked `!existing.includes("OpenWolf")` to decide
// whether to insert the CLAUDE.md snippet. A stale pre-v2 snippet (containing
// "OpenWolf") was never refreshed on update — the user kept the old eager,
// every-session snippet forever. Fix: detect the <!-- openwolf:v2 --> marker;
// if absent but the exact legacy snippet is present, replace it with v2; if
// "OpenWolf" appears without either (user modified it), leave it alone
// (don't overwrite user edits / don't duplicate).
//
// ensureClaudeMdSnippet is exported pure so it can be unit-tested without
// running init/update (which touch the filesystem + spawn nothing here, but
// the logic is the gate). Uses the REAL v2 template from src/templates/.

import { ensureClaudeMdSnippet, CLAUDE_MD_V2_MARKER } from "../dist/src/cli/claude-md.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The real v2 snippet (must start with the marker on line 1).
const V2 = fs.readFileSync(path.resolve(__dirname, "..", "src", "templates", "claude-md-snippet.md"), "utf-8").trimEnd();
// The exact pre-v2 snippet (must match the LEGACY constant in claude-md.ts).
const LEGACY = "# OpenWolf\n\n@.wolf/OPENWOLF.md\n\nThis project uses OpenWolf for context management. Read and follow .wolf/OPENWOLF.md every session. Check .wolf/cerebrum.md before generating code. Check .wolf/anatomy.md before reading files.";

assert(V2.startsWith(CLAUDE_MD_V2_MARKER), "fixture: real v2 template starts with the v2 marker");

// ─── 1. v2 already present → null (idempotent, no change) ──
{
  const existing = V2 + "\n\n# My Project\n\nuser content";
  const r = ensureClaudeMdSnippet(existing, V2);
  assert(r === null, "v2 present → null (idempotent, no rewrite)");
}

// ─── 2. exact legacy snippet → upgraded (legacy removed, v2 prepended) ──
{
  const existing = LEGACY + "\n\n# My Project\n\nuser content";
  const r = ensureClaudeMdSnippet(existing, V2);
  assert(r !== null, "legacy snippet → returns upgraded content (not null)");
  assert(r !== null && r.includes(CLAUDE_MD_V2_MARKER), "upgraded content has v2 marker");
  assert(r !== null && !r.includes(LEGACY), "upgraded content has legacy snippet REMOVED");
  assert(r !== null && r.includes("# My Project"), "upgraded content preserves user content");
  assert(r !== null && r.includes("user content"), "upgraded content preserves user text");
  assert(r !== null && !r.includes("Read and follow .wolf/OPENWOLF.md every session"), "legacy eager-phrase gone");
  assert(r !== null && r.startsWith(CLAUDE_MD_V2_MARKER), "upgraded content starts with v2 marker (v2 on top)");
}

// ─── 3. no OpenWolf at all → v2 inserted (prepend) ──
{
  const existing = "# My Project\n\nNo openwolf mention here.";
  const r = ensureClaudeMdSnippet(existing, V2);
  assert(r !== null, "no OpenWolf → returns content with v2 inserted");
  assert(r !== null && r.startsWith(CLAUDE_MD_V2_MARKER), "inserted content starts with v2");
  assert(r !== null && r.includes("# My Project"), "user content preserved on insert");
}

// ─── 4. modified old snippet (OpenWolf but no v2, no exact legacy) → null (safe skip) ──
{
  // User edited the old snippet — has "OpenWolf" but isn't the exact legacy text.
  const existing = "# OpenWolf\n\nI customized my openwolf notes here.\n\n# My Project";
  const r = ensureClaudeMdSnippet(existing, V2);
  assert(r === null, "modified old snippet → null (don't overwrite user edits)");
}

// ─── 5. legacy in the middle of user content → removed + v2 prepended, both halves kept ──
{
  const existing = "# My Top Content\n\n" + LEGACY + "\n\n# Bottom Content";
  const r = ensureClaudeMdSnippet(existing, V2);
  assert(r !== null, "legacy in middle → returns upgraded content");
  assert(r !== null && !r.includes(LEGACY), "legacy removed from middle");
  assert(r !== null && r.includes("# My Top Content"), "user top content preserved");
  assert(r !== null && r.includes("# Bottom Content"), "user bottom content preserved");
}

// ─── 6. no duplication — exactly one v2 marker after upgrade ──
{
  const r = ensureClaudeMdSnippet(LEGACY + "\n\nuser", V2);
  const markerCount = r !== null ? (r.match(/openwolf:v2/g) || []).length : 99;
  assert(markerCount === 1, `exactly one v2 marker after upgrade (got ${markerCount}, no duplication)`);
}

// ─── 7. empty existing → v2 inserted (edge case) ──
{
  const r = ensureClaudeMdSnippet("", V2);
  assert(r !== null && r.includes(CLAUDE_MD_V2_MARKER), "empty CLAUDE.md → v2 inserted");
}

// ─── 8. source: init.js + update.js wired to ensureClaudeMdSnippet, old check gone ──
{
  const initDist = fs.readFileSync(path.resolve(__dirname, "..", "dist", "src", "cli", "init.js"), "utf-8");
  const updateDist = fs.readFileSync(path.resolve(__dirname, "..", "dist", "src", "cli", "update.js"), "utf-8");
  assert(initDist.includes("ensureClaudeMdSnippet"), "init.js wired to ensureClaudeMdSnippet");
  assert(updateDist.includes("ensureClaudeMdSnippet"), "update.js wired to ensureClaudeMdSnippet");
  assert(!initDist.includes('!existing.includes("OpenWolf")'), "init.js no longer uses the old OpenWolf-string check");
  assert(!updateDist.includes('!existing.includes("OpenWolf")'), "update.js no longer uses the old OpenWolf-string check");
}

console.log(`\nG-claude-md-idempotency: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
