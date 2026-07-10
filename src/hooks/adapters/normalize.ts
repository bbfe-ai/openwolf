// Agent adapter seam (initiative 11).
//
// openwolf's hook core consumes Claude-shaped events:
//   { tool_name: "Edit"|"Write"|"Read", tool_input: { file_path, old_string, new_string, content } }
//
// Different AI agents deliver tool events in different shapes:
//   - Claude Code: native stdin JSON, already this shape (passthrough).
//   - Codex (OpenAI): stdin JSON, but file edits arrive as apply_patch with a V4A
//     patch text in `tool_input.command` — needs a V4A parser (filled in T2.x).
//   - OpenCode: in-process plugin events with camelCase args (filePath, oldString,
//     newString) — needs a field-name mapping (filled in T3.x).
//
// This module is the SEAM: hooks call normalizeToolEvent() on their input. Today
// only the claude branch is real (returns the input unchanged = zero behavior
// change); codex/opencode return null (noop, not yet wired into any hook's main
// logic). Subsequent tasks fill the branches. The goal: keep openwolf's hook
// core untouched; only the adapter layer knows which agent it is talking to.

export type AgentKind = "claude" | "codex" | "opencode";

/**
 * Claude-shaped tool event — the canonical internal representation that
 * openwolf's existing hook logic (post-write bug detection, memory append,
 * anatomy update) already consumes.
 */
export interface ClaudeShapedEvent {
  tool_name: string;
  tool_input: {
    file_path?: string;
    old_string?: string;
    new_string?: string;
    content?: string;
    [key: string]: unknown;
  };
}

/**
 * Detect which agent produced the current hook invocation.
 *
 * - `OPENWOLF_AGENT` env: set explicitly by the opencode plugin shim when it
 *   spawns a hook process (T3.x), so the claude-written hook knows it is being
 *   driven by opencode.
 * - Otherwise, if the parsed stdin envelope carries Codex-only fields
 *   (`hook_event_name` + `turn_id`), it is a Codex hook invocation.
 * - Otherwise (default): Claude Code (native hooks reading CLAUDE_PROJECT_DIR).
 */
export function detectAgent(rawInput: unknown, env: NodeJS.ProcessEnv = process.env): AgentKind {
  if (env.OPENWOLF_AGENT === "opencode") return "opencode";
  if (env.OPENWOLF_AGENT === "codex") return "codex";
  // Codex's PreToolUse/PostToolUse envelope always carries hook_event_name + turn_id
  // (schema.rs:270-291) — fields Claude's hook input never has.
  if (rawInput && typeof rawInput === "object") {
    const o = rawInput as Record<string, unknown>;
    if (typeof o.hook_event_name === "string" && "turn_id" in o) return "codex";
  }
  return "claude";
}

/**
 * Normalize an agent-specific tool event into the Claude-shaped canonical form.
 *
 * Returns the Claude-shaped event for consumption by the existing hook core, or
 * `null` when the event should be ignored (unknown tool, or an agent branch not
 * yet implemented).
 *
 * Today:
 *   - claude  → passthrough (input already canonical)        [LIVE]
 *   - codex   → null  (V4A parser lands in T2.1/T2.2)         [NOOP]
 *   - opencode→ null  (camelCase mapping lands in T3.x)       [NOOP]
 *
 * Hooks that opt into normalization call this and MUST no-op when it returns
 * null, so the unimplemented branches cannot accidentally fire.
 */
export function normalizeToolEvent(agent: AgentKind, rawInput: unknown): ClaudeShapedEvent | null {
  if (agent === "claude") {
    // Claude hooks receive { tool_name, tool_input } directly — already canonical.
    const o = rawInput as { tool_name?: string; tool_input?: Record<string, unknown> };
    if (!o.tool_name) return null;
    return { tool_name: o.tool_name, tool_input: (o.tool_input ?? {}) as ClaudeShapedEvent["tool_input"] };
  }
  // codex / opencode: not yet implemented. Returning null keeps hooks from acting
  // on partial data. T2.2 (codex) and T3.2 (opencode) replace these branches.
  return null;
}
