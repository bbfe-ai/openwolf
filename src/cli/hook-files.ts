// Shared list of hook scripts deployed to <project>/.wolf/hooks/.
//
// init.ts, update.ts, and status.ts all consume this single list. Keeping it in
// one place prevents the three from drifting — which is exactly what happened
// (OPT-31/44): update.ts deployed only 7 of 11 files and status.ts reported "all
// present" against the same 7, so after `openwolf update` the stop hook's
// `runPrune` / `buildIndex` imports failed with Cannot-find-module and prune +
// retrieval silently died. Only a fresh `openwolf init` deployed the full set.
//
// Entries containing a path separator ("adapters/...") are copied into the
// matching subdirectory; every deploy loop MUST `mkdirSync(path.dirname(dest),
// { recursive: true })` before copying, or the adapter entries ENOENT.
export const HOOK_FILES: readonly string[] = [
  "session-start.js",
  "pre-read.js",
  "pre-write.js",
  "post-read.js",
  "post-write.js",
  "stop.js",
  "shared.js",
  "prune.js",
  "retrieval.js",
  // Agent adapter seam (initiative 11): shared.js imports ./adapters/normalize.js,
  // so the adapter subdirectory must be deployed alongside the top-level hooks.
  "adapters/normalize.js",
  "adapters/codex-v4a.js",
  // Description extractor submodules (OPT-33): shared.js's extractDescription
  // imports ./descriptions/known.js (and the other 8 submodules it re-exports).
  // Forgetting these here means `openwolf init`/`update` deploys a shared.js
  // whose first `import "./descriptions/known.js"` throws ERR_MODULE_NOT_FOUND
  // → extractDescription silently dies. This is exactly the gap that bit the
  // test harness (descriptions/ copy block had to be hand-patched into 8 tests).
  "descriptions/known.js",
  "descriptions/cap.js",
  "descriptions/data.js",
  "descriptions/web.js",
  "descriptions/systems.js",
  "descriptions/php.js",
  "descriptions/tsjs.js",
  "descriptions/docs.js",
  "descriptions/fallback.js",
];
