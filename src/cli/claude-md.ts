// CLAUDE.md snippet idempotency + legacy upgrade (OPT-43).
//
// The v2 snippet (src/templates/claude-md-snippet.md) carries CLAUDE_MD_V2_MARKER
// on its first line. init/update use ensureClaudeMdSnippet to decide:
//   - v2 marker present            → already current, no change (idempotent)
//   - exact legacy snippet present → upgrade: remove it, prepend v2
//   - no "OpenWolf" at all         → insert fresh
//   - "OpenWolf" present but neither v2 nor exact legacy → user modified the
//     old snippet; leave it alone (avoid data loss / duplication)
// Before OPT-43 the check was merely `!existing.includes("OpenWolf")`, so a
// stale pre-v2 snippet was never refreshed on update.

export const CLAUDE_MD_V2_MARKER = "<!-- openwolf:v2 -->";

// The exact pre-v2 snippet (eager, every-session variant). Historical artifact
// kept as a constant for detecting + removing a stale snippet on upgrade.
const LEGACY_CLAUDE_MD_SNIPPET =
  "# OpenWolf\n\n@.wolf/OPENWOLF.md\n\nThis project uses OpenWolf for context management. Read and follow .wolf/OPENWOLF.md every session. Check .wolf/cerebrum.md before generating code. Check .wolf/anatomy.md before reading files.";

/**
 * Returns the new CLAUDE.md content with the v2 snippet ensured, or null if no
 * change is needed (already v2, or a user-modified snippet we won't overwrite).
 */
export function ensureClaudeMdSnippet(existing: string, v2Snippet: string): string | null {
  if (existing.includes(CLAUDE_MD_V2_MARKER)) {
    return null; // already v2 — idempotent
  }
  if (existing.includes(LEGACY_CLAUDE_MD_SNIPPET)) {
    // exact legacy snippet — upgrade: remove it, prepend v2
    const cleaned = existing.replace(LEGACY_CLAUDE_MD_SNIPPET, "").replace(/^\s+/, "");
    return `${v2Snippet}\n\n${cleaned}`;
  }
  if (!existing.includes("OpenWolf")) {
    return `${v2Snippet}\n\n${existing}`;
  }
  return null; // user-modified snippet — don't overwrite (avoid data loss / duplication)
}
