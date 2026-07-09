import * as fs from "node:fs";
import * as path from "node:path";
import { findProjectRoot } from "../scanner/project-root.js";
import { search, buildIndex, indexExists } from "../hooks/retrieval.js";
import type { IndexedFile } from "../hooks/retrieval.js";

const VALID_FILES: IndexedFile[] = ["memory", "cerebrum", "buglog"];

export function searchCommand(term: string, opts: { file?: string; top?: string }): void {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");

  if (!fs.existsSync(wolfDir)) {
    console.log("OpenWolf not initialized. Run: openwolf init");
    return;
  }

  let file: IndexedFile | undefined;
  if (opts.file) {
    if (!(VALID_FILES as string[]).includes(opts.file)) {
      console.log(`--file must be one of: ${VALID_FILES.join(", ")} (anatomy.md is fully injected, not searched)`);
      return;
    }
    file = opts.file as IndexedFile;
  }

  if (!indexExists(wolfDir)) buildIndex(wolfDir);

  const topK = opts.top ? Math.max(1, parseInt(opts.top, 10) || 10) : 10;
  const hits = search(wolfDir, term, { file, topK });

  if (hits.length === 0) {
    console.log(`No matches for "${term}". (Try 'openwolf search' after a session so the index is built.)`);
    return;
  }

  console.log(`Found ${hits.length} match(es) for "${term}":\n`);
  for (const h of hits) {
    const ext = h.file === "buglog" ? ".json" : ".md";
    console.log(`  .wolf/${h.file}${ext}:${h.locator}  [${h.section || "-"}]  (score ${h.score})`);
    console.log(`    ${h.snippet}`);
    console.log("");
  }
  console.log("Open the file at the locator above — do not read the whole file.");
}
