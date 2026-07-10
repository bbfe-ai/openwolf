// G-retrieval-quality: stopword filter + mtime-incremental index gate.
// Covers OPT-15 (no stopword filter → index bloat + filler words dominate
// search) and OPT-16 (buildIndex rebuilt the whole index every Stop even when
// nothing changed → needless O(n) I/O each session).
//
// OPT-15: tokenize filters English stopwords from ASCII tokens at both index
// and query time (tokenize is shared), so "the bug" queries the same as "bug".
// CJK tokens are never filtered. OPT-16: buildIndex returns true when it
// rebuilds, false when it skips (index fresh = built at/after newest source
// mtime); a missing source forces a rebuild. The boolean return is the
// false-green guard — a void buildIndex could silently skip-or-rebuild
// without a testable signal.

import { tokenize, buildIndex, search } from "../dist/hooks/retrieval.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

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
const has = (arr, t) => arr.includes(t);

// ─── 1. tokenize filters English stopwords, keeps content + CJK ──
{
  const t1 = tokenize("the file is an error and a bug");
  assert(!has(t1, "the") && !has(t1, "is") && !has(t1, "an") && !has(t1, "and") && !has(t1, "a"), `stopwords the/is/an/and/a filtered out`);
  assert(has(t1, "file") && has(t1, "error") && has(t1, "bug"), `content tokens file/error/bug kept`);

  const t2 = tokenize("修复 the bug");
  assert(!has(t2, "the"), `stopword "the" filtered from mixed CJK+ASCII text`);
  assert(has(t2, "bug"), `ascii "bug" kept in mixed text`);
  assert(has(t2, "修") && has(t2, "复") && has(t2, "修复"), `CJK char + bigram kept (修/复/修复), never filtered`);

  const t3 = tokenize("The Quick Brown Fox");
  assert(!has(t3, "the"), `case-insensitive: "The" filtered`);
  assert(has(t3, "quick") && has(t3, "brown") && has(t3, "fox"), `mixed-case content kept (quick/brown/fox)`);
}

// ─── 2-5. buildIndex mte: build → skip → rebuild-on-change → rebuild-on-missing ──
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ow-retq-build-"));
  const wolfDir = path.join(tmp, ".wolf");
  fs.mkdirSync(wolfDir, { recursive: true });
  fs.writeFileSync(path.join(wolfDir, "memory.md"), "# Memory\n\n## Session: 2026-07-10\n\n| the bug fix | in a.ts |\n");
  fs.writeFileSync(path.join(wolfDir, "cerebrum.md"), "# Cerebrum\n\n## Key Learnings\n- the bug pattern is real\n");
  fs.writeFileSync(path.join(wolfDir, "buglog.json"), JSON.stringify({ version: 1, bugs: [{ id: "b1", error_message: "the bug crash", fix: "restart" }] }));

  const idxPath = path.join(wolfDir, "index", "wolf-index.json");

  // 2. no index → build (returns true)
  const built = buildIndex(wolfDir);
  assert(built === true, `first buildIndex returns true (rebuilt)`);
  assert(fs.existsSync(idxPath), `index file created`);
  const idx = JSON.parse(fs.readFileSync(idxPath, "utf-8"));
  assert(idx.built_at && idx.built_at.length > 0, `index has built_at timestamp`);
  assert(!("the" in idx.postings), `stopword "the" NOT in postings (OPT-15 at index time)`);
  assert("bug" in idx.postings, `"bug" in postings`);

  // search sanity: "bug" matches; "the bug" == "bug" (query stopwords filtered)
  const hits = search(wolfDir, "bug");
  assert(hits.length > 0 && hits[0].score > 0, `search("bug") returns scored hits`);
  const hitsWithStop = search(wolfDir, "the bug");
  assert(hitsWithStop.length === hits.length, `search("the bug") == search("bug") (query stopword filtered, OPT-15)`);

  const built_at_1 = idx.built_at;

  // 3. unchanged sources → skip (returns false, built_at byte-identical)
  const built2 = buildIndex(wolfDir);
  assert(built2 === false, `second buildIndex (sources unchanged) returns false (skipped, OPT-16)`);
  const idx2 = JSON.parse(fs.readFileSync(idxPath, "utf-8"));
  assert(idx2.built_at === built_at_1, `skipped build leaves built_at byte-identical (no rewrite)`);

  // 4. source modified (future mtime) → rebuild (returns true, new content indexed)
  const cerebrumPath = path.join(wolfDir, "cerebrum.md");
  fs.writeFileSync(cerebrumPath, "# Cerebrum\n\n## Key Learnings\n- the zebranew thing is real\n");
  const future = new Date(Date.now() + 86400000); // unambiguously newer than built_at
  fs.utimesSync(cerebrumPath, future, future);
  const built3 = buildIndex(wolfDir);
  assert(built3 === true, `buildIndex after source change returns true (rebuilt, OPT-16)`);
  const zebra = search(wolfDir, "zebranew");
  assert(zebra.length > 0, `rebuild indexed new cerebrum content (search "zebranew" hits)`);

  // 5. missing source → rebuild (newestSourceMtime=Infinity forces it)
  fs.unlinkSync(path.join(wolfDir, "memory.md"));
  const built4 = buildIndex(wolfDir);
  assert(built4 === true, `buildIndex with missing source returns true (Infinity mtime forces rebuild)`);
  const idx4 = JSON.parse(fs.readFileSync(idxPath, "utf-8"));
  const memoryRecords = idx4.records.filter((r) => r.file === "memory").length;
  assert(memoryRecords === 0, `missing memory.md → 0 memory records in rebuilt index`);

  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nG-retrieval-quality: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
