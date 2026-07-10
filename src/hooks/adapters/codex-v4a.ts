// V4A patch parser for the Codex adapter (initiative 11, T2.1).
//
// Codex's apply_patch tool delivers file edits as a single `{"command": "<V4A patch>"}`
// payload (codex-rs/core/src/tools/handlers/apply_patch.rs:505-509). The V4A grammar
// (codex-rs/core/src/tools/handlers/apply_patch.lark) is line-based:
//
//   *** Begin Patch
//   *** Add File: <path>          + new file lines ("+" prefix)
//   *** Delete File: <path>
//   *** Update File: <path>
//   *** Move to: <path>           (rename, optional)
//   @@ [context]                  (hunk context separator, optional)
//    <context line>                (" " prefix = unchanged)
//   -<removed line>               ("-" prefix = old)
//   +<added line>                  ("+" prefix = new)
//   *** End of File                (marks tail of file)
//   *** End Patch
//
// This parser extracts, per Update-File hunk, the consecutive (-) old blocks and
// (+) new blocks into {oldString, newString} pairs — the shape openwolf's
// bug-detection/memory logic already consumes. Add/Delete/Move are reported as
// their own change kinds so the normalizer (T2.2) can map them.

export interface V4AChange {
  kind: "replace" | "add" | "delete";
  oldString?: string;
  newString?: string;
}

export interface V4AHunk {
  filePath: string;
  changes: V4AChange[];
}

/**
 * Parse a V4A patch text into per-file hunks.
 *
 * - Add File → one {kind:"add", newString:<added lines>}
 * - Delete File → one {kind:"delete", oldString:""} (whole file removed)
 * - Update File → one or more {kind:"replace", oldString, newString}: each
 *   maximal run of "-" lines becomes oldString, the immediately-following run
 *   of "+" lines becomes newString. Context (" ") lines are skipped (they are
 *   anchors, not part of the replacement).
 * - Move to → contributes to filePath (the rename target) for the enclosing
 *   Update hunk; tracked but not emitted as a standalone change.
 *
 * Returns [] for input that is not a V4A patch (no "*** Begin Patch").
 */
export function parseV4APatch(command: string): V4AHunk[] {
  if (typeof command !== "string" || !command.includes("*** Begin Patch")) return [];

  const lines = command.split("\n");
  const hunks: V4AHunk[] = [];
  let i = 0;

  // Find *** Begin Patch
  while (i < lines.length && !lines[i].startsWith("*** Begin Patch")) i++;
  i++; // move past the Begin Patch line

  while (i < lines.length) {
    const line = lines[i];

    if (line === undefined || line.startsWith("*** End Patch")) break;

    if (line.startsWith("*** Add File: ")) {
      const filePath = line.slice("*** Add File: ".length).trim();
      i++;
      const added: string[] = [];
      while (i < lines.length && lines[i].startsWith("+")) {
        added.push(lines[i].slice(1));
        i++;
      }
      hunks.push({ filePath, changes: [{ kind: "add", newString: added.join("\n") }] });
      continue;
    }

    if (line.startsWith("*** Delete File: ")) {
      const filePath = line.slice("*** Delete File: ".length).trim();
      hunks.push({ filePath, changes: [{ kind: "delete", oldString: "" }] });
      i++;
      continue;
    }

    if (line.startsWith("*** Update File: ")) {
      let filePath = line.slice("*** Update File: ".length).trim();
      i++;
      // *** Move to: <path> (optional, renames within this hunk)
      if (i < lines.length && lines[i].startsWith("*** Move to: ")) {
        filePath = lines[i].slice("*** Move to: ".length).trim();
        i++;
      }
      const changes: V4AChange[] = [];
      // Walk the hunk body until the next *** header or End Patch / End of File.
      while (i < lines.length) {
        const b = lines[i];
        if (b === undefined) break;
        if (b.startsWith("***")) break; // next hunk header or End Patch / End of File

        // Optional context anchor lines (" " prefix or "@@").
        if (b.startsWith("@@") || b.startsWith(" ")) { i++; continue; }

        // A replacement block: one run of "-" then one run of "+".
        if (b.startsWith("-")) {
          const oldLines: string[] = [];
          while (i < lines.length && lines[i].startsWith("-")) {
            oldLines.push(lines[i].slice(1));
            i++;
          }
          const newLines: string[] = [];
          while (i < lines.length && lines[i].startsWith("+")) {
            newLines.push(lines[i].slice(1));
            i++;
          }
          changes.push({
            kind: "replace",
            oldString: oldLines.join("\n"),
            newString: newLines.join("\n"),
          });
          continue;
        }

        // Bare "+" without preceding "-" (pure insertion within an update).
        if (b.startsWith("+")) {
          const newLines: string[] = [];
          while (i < lines.length && lines[i].startsWith("+")) {
            newLines.push(lines[i].slice(1));
            i++;
          }
          changes.push({ kind: "replace", oldString: "", newString: newLines.join("\n") });
          continue;
        }

        // Anything else: skip defensively (shouldn't happen in valid V4A).
        i++;
      }
      if (changes.length > 0) hunks.push({ filePath, changes });
      continue;
    }

    // Unknown header or stray line — skip.
    i++;
  }

  return hunks;
}
