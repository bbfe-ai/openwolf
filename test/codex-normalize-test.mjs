// T2.2 codex envelope normalization verification — proves normalizeToolEvent
// turns a codex PreToolUse/PostToolUse envelope into Claude-shaped Edit events,
// with the file_path/old_string/new_string extracted from the V4A patch.
//
// Run: node test/codex-normalize-test.mjs
import { detectAgent, normalizeToolEvent } from "../dist/hooks/adapters/normalize.js";

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got:  ${g}\n      want: ${w}`); }
}

// Codex PreToolUse envelope shape (schema.rs:270-291, snake_case — verified:
// no #[serde(rename_all)] on PreToolUseCommandInput; test pre_tool_use.rs:344
// asserts input["tool_name"] == "apply_patch"). hook_event_name + turn_id are
// the codex-distinct fields detectAgent keys on.
const codexEnvelope = (toolName, toolInput) => ({
  session_id: "s1", turn_id: "t1", cwd: "/proj", hook_event_name: "PreToolUse",
  model: "gpt-5-codex", permission_mode: "default",
  tool_name: toolName, tool_input: toolInput, tool_use_id: "call_1",
});

// ── 1. detectAgent: codex envelope → "codex" ──
eq("detect codex envelope", detectAgent(codexEnvelope("apply_patch", { command: "" })), "codex");

// ── 2. detectAgent: claude-shaped input (no hook_event_name/turn_id) → "claude" ──
eq("detect claude input", detectAgent({ tool_name: "Edit", tool_input: {} }), "claude");

// ── 3. detectAgent: OPENWOLF_AGENT env override ──
eq("detect opencode via env", detectAgent({}, { OPENWOLF_AGENT: "opencode" }), "opencode");

// ── 4. single-file apply_patch → one Edit event ──
const patch1 = "*** Begin Patch\n*** Update File: src/app.ts\n-old = 1;\n+old = 2;\n*** End Patch";
eq("single-file patch -> 1 Edit", normalizeToolEvent("codex", codexEnvelope("apply_patch", { command: patch1 })), [
  { tool_name: "Edit", tool_input: { file_path: "src/app.ts", old_string: "old = 1;", new_string: "old = 2;" } },
]);

// ── 5. multi-file apply_patch → one Edit per file/change ──
const patch2 = `*** Begin Patch
*** Update File: a.ts
-x = 1;
+x = 2;
*** Add File: b.ts
+export const B = 1;
*** Delete File: c.ts
*** End Patch`;
eq("multi-file patch -> 3 events", normalizeToolEvent("codex", codexEnvelope("apply_patch", { command: patch2 })), [
  { tool_name: "Edit", tool_input: { file_path: "a.ts", old_string: "x = 1;", new_string: "x = 2;" } },
  { tool_name: "Edit", tool_input: { file_path: "b.ts", old_string: "", new_string: "export const B = 1;" } },
  { tool_name: "Edit", tool_input: { file_path: "c.ts", old_string: "", new_string: "" } },
]);

// ── 6. multi-block hunk -> multiple Edit events (same file) ──
const patch3 = `*** Begin Patch
*** Update File: u.ts
-x;
+x2;
 ctx
-y;
+y2;
*** End Patch`;
eq("multi-block hunk -> 2 Edits same file", normalizeToolEvent("codex", codexEnvelope("apply_patch", { command: patch3 })), [
  { tool_name: "Edit", tool_input: { file_path: "u.ts", old_string: "x;", new_string: "x2;" } },
  { tool_name: "Edit", tool_input: { file_path: "u.ts", old_string: "y;", new_string: "y2;" } },
]);

// ── 7. non-apply_patch codex tool (Bash) -> empty (D1: no clean file event) ──
eq("codex Bash tool -> []", normalizeToolEvent("codex", codexEnvelope("Bash", { command: "cat foo.txt" })), []);

// ── 8. claude passthrough still works ──
eq("claude passthrough", normalizeToolEvent("claude", { tool_name: "Edit", tool_input: { file_path: "s.ts", old_string: "a", new_string: "b" } }), [
  { tool_name: "Edit", tool_input: { file_path: "s.ts", old_string: "a", new_string: "b" } },
]);

// ── 9. opencode still noop (T3.x) ──
eq("opencode noop", normalizeToolEvent("opencode", { tool: "edit", args: { filePath: "x" } }), []);

// ── 10. missing command -> [] (no crash) ──
eq("apply_patch missing command -> []", normalizeToolEvent("codex", codexEnvelope("apply_patch", {})), []);

console.log(`\n${fail === 0 ? "ALL GREEN" : `${fail} FAILED`} (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
