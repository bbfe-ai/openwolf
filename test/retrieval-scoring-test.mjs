// G-retrieval-scoring: BM25-IDF weighting gate (OPT-14).
//
// Before OPT-14, search() scored each matched term +1 (plain term frequency),
// so high-frequency filler dominated ranking. OPT-14 weights each term by
// Laplace-smoothed IDF log((N+1)/(df+1)) — rare terms count more.
//
// The index is binary-presence (tokenize dedupes per record → TF is always 1
// per matched term), so this is the IDF component of BM25 with binary TF;
// full BM25 saturation/length-norm needs TF + doc-length storage (deferred).
//
// Fixture: 5 buglog records each [common, shared, failure]; 1 cerebrum record
// [rare, shared, gem, unique, here]. N=6. df(common)=5, df(shared)=6(universal),
// df(rare)=1. idf(common)=log(7/6), idf(rare)=log(7/2)=log(3.5), idf(shared)=0.
//
// False-green guard: every ordering/score assertion below FAILS if the scorer
// is still plain +1 (under plain TF all 6 records tie at 1.0 and the file
// tiebreak puts buglog first, not cerebrum; scores are 1.0 not log(3.5)).

import { buildIndex, search } from "../dist/hooks/retrieval.js";
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
const close = (a, b) => Math.abs(a - b) < 1e-9;

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ow-score-"));
  const wolfDir = path.join(tmp, ".wolf");
  fs.mkdirSync(wolfDir, { recursive: true });

  // 5 buglog records, each text "common shared failure N" → [common, shared, failure]
  const bugs = [];
  for (let i = 1; i <= 5; i++) bugs.push({ id: `b${i}`, error_message: `common shared failure ${i}` });
  fs.writeFileSync(path.join(wolfDir, "buglog.json"), JSON.stringify({ version: 1, bugs }));
  // 1 cerebrum record → [rare, shared, gem, unique, here] (the/is stopwords)
  fs.writeFileSync(path.join(wolfDir, "cerebrum.md"), "# Cerebrum\n## Notes\n- the rare shared gem is unique here\n");
  // memory.md intentionally absent (newestSourceMtime=Infinity forces build)

  const built = buildIndex(wolfDir);
  assert(built === true, `buildIndex returns true (fresh build)`);

  // ─── 1. IDF reorders: rare-matcher ranks #1 (plain TF would put buglog first) ──
  const cr = search(wolfDir, "common rare");
  assert(cr.length === 6, `query "common rare" matches all 6 records (5 common + 1 rare)`);
  assert(cr[0].file === "cerebrum", `rare-matcher (cerebrum) ranks #1 — NOT buglog (plain-TF tiebreak would put buglog first)`);
  assert(close(cr[0].score, Math.log(3.5)), `cerebrum score = log((N+1)/(df+1)) = log(7/2) = log(3.5) ≈ ${Math.log(3.5).toFixed(4)}`);
  assert(cr[0].score > 1, `rare-matcher score > 1 (exceeds plain-TF single-term max of 1.0)`);
  assert(cr.slice(1).every((h) => close(h.score, Math.log(7 / 6))), `5 buglog (common-only) hits each score log(7/6) ≈ ${Math.log(7 / 6).toFixed(4)}`);

  // ─── 2. IDF sums across matched terms (binary TF, two rare terms in one record) ──
  const rg = search(wolfDir, "rare gem");
  assert(rg.length === 1, `query "rare gem" matches the 1 cerebrum record (has both)`);
  assert(close(rg[0].score, 2 * Math.log(3.5)), `score = idf(rare)+idf(gem) = 2*log(3.5) (IDF summed across matched terms, not maxed)`);

  // ─── 3. Universal term (df=N) → idf 0, still returned as a hit ──
  const sh = search(wolfDir, "shared");
  assert(sh.length === 6, `universal term "shared" (df=N=6) still returns all 6 hits`);
  assert(sh.every((h) => h.score === 0), `every universal-term hit scores 0 (idf=log((N+1)/(N+1))=0; carries no discriminative info)`);

  // ─── 4. Single rare term ──
  const r = search(wolfDir, "rare");
  assert(r.length === 1 && r[0].file === "cerebrum" && close(r[0].score, Math.log(3.5)), `single rare term: 1 cerebrum hit, score log(3.5)`);

  // ─── 5. No match ──
  const nm = search(wolfDir, "nonexistentxyz");
  assert(nm.length === 0, `no-match query returns 0 hits`);

  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nG-retrieval-scoring: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
