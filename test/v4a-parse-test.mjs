// T2.1 V4A parser verification — proves the parser extracts the RIGHT fields,
// not just that it runs without crashing (byte parity per fixture).
//
// Run: node test/v4a-parse-test.mjs
// Exits 0 only if every fixture's parsed output matches the expected structure exactly.

import { parseV4APatch } from "../dist/hooks/adapters/codex-v4a.js";

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got:  ${g}\n      want: ${w}`); }
}

// ── Fixture 1: single file, single replace (the canonical codex sample shape) ──
const f1 = `*** Begin Patch
*** Update File: src/app.ts
@@ function greet
 function greet(name) {
-return "hello " + name;
+return "hi " + name + "!";
 }
*** End Patch`;
eq("f1 single replace", parseV4APatch(f1), [
  { filePath: "src/app.ts", changes: [
    { kind: "replace", oldString: 'return "hello " + name;', newString: 'return "hi " + name + "!";' },
  ] },
]);

// ── Fixture 2: multiple files in one patch (multi-hunk) ──
const f2 = `*** Begin Patch
*** Update File: a.ts
-old = 1;
+old = 2;
*** Add File: new.ts
+export const X = 1;
+export const Y = 2;
*** Delete File: dead.ts
*** End Patch`;
eq("f2 multi-hunk (update+add+delete)", parseV4APatch(f2), [
  { filePath: "a.ts", changes: [{ kind: "replace", oldString: "old = 1;", newString: "old = 2;" }] },
  { filePath: "new.ts", changes: [{ kind: "add", newString: "export const X = 1;\nexport const Y = 2;" }] },
  { filePath: "dead.ts", changes: [{ kind: "delete", oldString: "" }] },
]);

// ── Fixture 3: context lines + multiple replace blocks in one hunk ──
const f3 = `*** Begin Patch
*** Update File: lib/util.ts
 function top() {
-x = 1;
+x = 2;
   // keep
-y = 3;
+y = 4;
 }
*** End Patch`;
eq("f3 two replace blocks with context", parseV4APatch(f3), [
  { filePath: "lib/util.ts", changes: [
    { kind: "replace", oldString: "x = 1;", newString: "x = 2;" },
    { kind: "replace", oldString: "y = 3;", newString: "y = 4;" },
  ] },
]);

// ── Fixture 4: pure insertion (only +, no -) within an update ──
const f4 = `*** Begin Patch
*** Update File: src/app.ts
 function f() {
+return newThing();
 }
*** End Patch`;
eq("f4 pure insertion", parseV4APatch(f4), [
  { filePath: "src/app.ts", changes: [
    { kind: "replace", oldString: "", newString: "return newThing();" },
  ] },
]);

// ── Fixture 5: not a V4A patch at all → empty (no crash) ──
eq("f5 non-patch input -> []", parseV4APatch("just some text, no markers"), []);
eq("f6 empty input -> []", parseV4APatch(""), []);

// ── Fixture 7: *** Move to (rename) within an update hunk ──
const f7 = `*** Begin Patch
*** Update File: old.ts
*** Move to: new.ts
-old = 1;
+old = 2;
*** End Patch`;
eq("f7 Move to rename target", parseV4APatch(f7), [
  { filePath: "new.ts", changes: [{ kind: "replace", oldString: "old = 1;", newString: "old = 2;" }] },
]);

console.log(`\n${fail === 0 ? "ALL GREEN" : `${fail} FAILED`} (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
