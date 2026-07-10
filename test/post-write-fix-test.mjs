// G-post-write-fix: detectFixPattern filename bug (OPT-1) + codeExts dedup (OPT-35).
//
// OPT-1: detectFixPattern(oldStr, newStr, ext) had no filename param, so the
// null-safety + refactor summaries used path.basename("") (and even
// path.basename(path.basename(""))) — yielding "Null/undefined access in "
// and "Significant refactor of " with an empty file name. Fix: pass `filename`
// from the caller (autoDetectBugFix has `basename`) and use it in those
// summaries. L359 (path.basename(fn), fn=function name, never empty) left as-is.
//
// OPT-35: two identical `codeExts = new Set([...])` Sets (in updateAnatomyEntry
// + summarizeEdit) → one module-level CODE_EXTS const.
//
// False-green guard: under the OPT-1 bug the summaries contained no filename,
// so summary.includes(filename) fails. Under OPT-35 the duplicate Set
// remained, so the count check fails. detectFixPattern is exported (cf. OPT-31
// copyHookScripts) so the compiled deploy artifact can be unit-tested directly.

import { detectFixPattern } from "../dist/hooks/post-write.js";
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

// ─── OPT-1: summaries include the filename, not "" ──
{
  // null-safety branch: `?.` added → "Null/undefined access in <filename>"
  const ns = detectFixPattern("x.foo", "x?.foo", ".ts", "auth.ts");
  assert(ns !== null, `null-safety: detectFixPattern returns a detection`);
  assert(ns?.category === "null-safety", `null-safety: category === "null-safety" (got ${ns?.category})`);
  assert(ns?.summary.includes("auth.ts"), `null-safety: summary includes filename "auth.ts" (got "${ns?.summary}")`);
  assert(!ns?.summary.endsWith("in "), `null-safety: summary does NOT end with "in " (empty filename, the OPT-1 bug)`);

  // refactor branch: 4 short lines → 4 long lines, no keywords/operators, so
  // only the catch-all refactor branch can fire → "Significant refactor of <filename>"
  const oldStr = "alpha\nbeta\ngamma\ndelta";
  const newStr = "alphabetagamma\nbetagammadelta\ngammadeltaalpha\ndeltaalphabetagamma";
  const rf = detectFixPattern(oldStr, newStr, ".ts", "auth.ts");
  assert(rf !== null, `refactor: detectFixPattern returns a detection`);
  assert(rf?.category === "refactor", `refactor: category === "refactor" (got ${rf?.category})`);
  assert(rf?.summary.includes("auth.ts"), `refactor: summary includes filename "auth.ts" (got "${rf?.summary}")`);
  assert(!rf?.summary.endsWith("of "), `refactor: summary does NOT end with "of " (empty filename, the OPT-1 bug)`);
}

// ─── OPT-35: codeExts deduped to one module-level CODE_EXTS (verify deployed dist) ──
{
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const dist = fs.readFileSync(path.resolve(__dirname, "..", "dist", "hooks", "post-write.js"), "utf-8");
  assert(dist.includes("CODE_EXTS"), `OPT-35: CODE_EXTS const present in deployed dist/hooks/post-write.js`);
  const codeExtSets = (dist.match(/new Set\(\["\.ts"/g) || []).length;
  assert(codeExtSets === 1, `OPT-35: exactly 1 \`new Set([".ts"...]\` in dist (was 2; got ${codeExtSets})`);
  const emptyBasename = (dist.match(/path\.basename\(""\)/g) || []).length;
  assert(emptyBasename === 0, `OPT-1: no \`path.basename("")\` left in dist (got ${emptyBasename})`);
}

console.log(`\nG-post-write-fix: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
