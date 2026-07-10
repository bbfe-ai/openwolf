// Agent adapter seam (initiative 11).
//
// openwolf's hook core consumes Claude-shaped events:
//   { tool_name: "Edit"|"Write"|"Read", tool_input: { file_path, old_string, new_string, content } }
//
// Different AI agents deliver tool events in different shapes:
//   - Claude Code: native stdin JSON, already this shape (passthrough).
//   - Codex (OpenAI): stdin JSON, but file edits arrive as apply_patch with a V4A
//     patch text in `tool_input.command` — parsed into one-or-many Claude events.
//   - OpenCode: in-process plugin events with camelCase args (filePath, oldString,
//     newString) — needs a field-name mapping (filled in T3.x).
//
// This module is the SEAM: hooks call normalizeToolEvent() on their input and get
// back zero-or-more Claude-shaped events. The hook core stays untouched; only the
// adapter layer knows which agent it is talking to.

import { parseV4APatch } from "./codex-v4a.js";

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
 * Normalize an agent-specific tool event into zero-or-more Claude-shaped events.
 *
 * Returns an array (possibly empty) — a single agent event can expand to many
 * Claude events (e.g. one codex apply_patch touching 3 files → 3 Edit events).
 * Hooks iterate the result and no-op on empty, so unimplemented branches are safe.
 *
 *   - claude   → passthrough (input already canonical)               [LIVE]
 *   - codex    → apply_patch V4A patch → one Edit per file/hunk      [LIVE T2.2]
 *   - opencode → null []  (camelCase mapping lands in T3.x)          [NOOP]
 */
export function normalizeToolEvent(agent: AgentKind, rawInput: unknown): ClaudeShapedEvent[] {
  if (agent === "claude") {
    // Claude hooks receive { tool_name, tool_input } directly — already canonical.
    const o = rawInput as { tool_name?: string; tool_input?: Record<string, unknown> };
    if (!o.tool_name) return [];
    return [{ tool_name: o.tool_name, tool_input: (o.tool_input ?? {}) as ClaudeShapedEvent["tool_input"] }];
  }

  if (agent === "codex") {
    return normalizeCodex(rawInput);
  }

  // opencode: not yet implemented (T3.x). Empty array keeps hooks from acting
  // on partial data.
  return [];
}

/**
 * Normalize a Codex PreToolUse/PostToolUse envelope into Claude-shaped events.
 *
 * Codex envelope (schema.rs:270-291) carries tool_name + tool_input on the wire.
 * File edits arrive as tool_name "apply_patch" with tool_input = {"command": "<V4A>"}.
 * We parse the V4A patch and emit one Edit event per file/change. Non-apply_patch
 * tools (Bash, etc.) yield no Claude-shaped file event → empty (D1: codex reads
 * via Bash, no clean file_read).
 */
function normalizeCodex(rawInput: unknown): ClaudeShapedEvent[] {
  const o = rawInput as { tool_name?: string; tool_input?: { command?: string } };
  if (!o.tool_name) return [];

  if (o.tool_name === "apply_patch") {
    const command = o.tool_input?.command;
    if (typeof command !== "string") return [];
    const hunks = parseV4APatch(command);
    const events: ClaudeShapedEvent[] = [];
    for (const h of hunks) {
      for (const c of h.changes) {
        // Map each V4A change onto the Edit shape openwolf's post-write logic expects.
        events.push({
          tool_name: "Edit",
          tool_input: {
            file_path: h.filePath,
            old_string: c.oldString ?? "",
            new_string: c.newString ?? "",
          },
        });
      }
    }
    return events;
  }

  // Other codex tools (Bash, MCP tools) are not file-shaped → no Claude event.
  return [];
}

