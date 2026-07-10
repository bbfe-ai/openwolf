// G-cron-prompt-config: cerebrum.max_tokens wired into reflection prompt (OPT-26).
//
// Before OPT-26, cerebrum.max_tokens: 2000 in config.json was dead config —
// nothing read it. The cerebrum-reflection cron task prompt hardcoded
// "Keep the file under 2000 tokens", so editing the config had no effect
// (false security). Fix: the prompt now carries {{cerebrum.max_tokens}};
// runAiTask resolves it from readConfig() before spawning claude -p.
//
// resolveCerebrumMaxTokens is exported pure (config is a param) so it can be
// tested without spawning claude -p (which runAiTask does — untestable in
// unit tests). Gate: custom value substituted, missing config → default 2000,
// non-number → default, no-placeholder → unchanged. Plus source assertions
// that the template carries the placeholder (not the old hardcoded "2000")
// and the dist wired the function + reads config.

import { resolveCerebrumMaxTokens } from "../dist/src/daemon/cron-engine.js";
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

const TPL = "Keep the file under {{cerebrum.max_tokens}} tokens.";

// ─── 1. custom value substituted ──
{
  const out = resolveCerebrumMaxTokens(TPL, { cerebrum: { max_tokens: 1500 } });
  assert(out === "Keep the file under 1500 tokens.", `custom max_tokens=1500 substituted (got "${out}")`);
  assert(!out.includes("{{"), `no leftover placeholder after substitution`);
}

// ─── 2. missing cerebrum section → default 2000 ──
{
  const out = resolveCerebrumMaxTokens(TPL, {});
  assert(out === "Keep the file under 2000 tokens.", `missing cerebrum → default 2000 (got "${out}")`);
}

// ─── 3. cerebrum present but no max_tokens → default 2000 ──
{
  const out = resolveCerebrumMaxTokens(TPL, { cerebrum: { reflection_frequency: "weekly" } });
  assert(out === "Keep the file under 2000 tokens.", `cerebrum without max_tokens → default 2000 (got "${out}")`);
}

// ─── 4. non-number max_tokens (string) → default 2000 (type guard) ──
{
  const out = resolveCerebrumMaxTokens(TPL, { cerebrum: { max_tokens: "3000" } });
  assert(out === "Keep the file under 2000 tokens.", `string max_tokens ignored → default 2000 (got "${out}")`);
}

// ─── 5. no placeholder in prompt → unchanged (no crash) ──
{
  const plain = "Return the cleaned file content only.";
  const out = resolveCerebrumMaxTokens(plain, { cerebrum: { max_tokens: 1500 } });
  assert(out === plain, `prompt without placeholder is unchanged (got "${out}")`);
}

// ─── 6. source: template carries placeholder, NOT old hardcoded "2000 tokens" ──
{
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const manifest = fs.readFileSync(path.resolve(__dirname, "..", "src", "templates", "cron-manifest.json"), "utf-8");
  assert(manifest.includes("{{cerebrum.max_tokens}}"), `cron-manifest.json template has {{cerebrum.max_tokens}} placeholder`);
  assert(!manifest.includes("under 2000 tokens"), `cron-manifest.json no longer hardcodes "under 2000 tokens" (the OPT-26 dead-config symptom)`);
}

// ─── 7. source: dist wired the function + reads config ──
{
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const dist = fs.readFileSync(path.resolve(__dirname, "..", "dist", "src", "daemon", "cron-engine.js"), "utf-8");
  assert(dist.includes("resolveCerebrumMaxTokens"), `dist exports/calls resolveCerebrumMaxTokens`);
  assert(dist.includes("{{cerebrum.max_tokens}}"), `dist has the placeholder literal in the replace call`);
  assert(/readConfig\(\)/.test(dist), `dist calls readConfig() in runAiTask (wired to config, not hardcoded)`);
}

console.log(`\nG-cron-prompt-config: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
