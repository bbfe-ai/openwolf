// G-update-deploy: openwolf update hook deployment gate (OPT-31/44, P0).
//
// Proves `copyHookScripts` — the function `openwolf update` calls per registered
// project — deploys ALL 11 hook files, including the 4 it used to silently drop
// (prune.js, retrieval.js, adapters/normalize.js, adapters/codex-v4a.js), AND
// that the adapters/ subdirectory is created. The old copy loop had no
// mkdirSync, so naively adding the adapter entries would have ENOENT'd; this
// gate fails loudly if that regresses.
//
// Root cause this guards against: init.ts deployed 11 files, update.ts deployed
// only 7, status.ts checked only 7 — three forked copies of the list. After
// `openwolf update`, stop.js's runPrune / buildIndex imports failed with
// Cannot-find-module and prune + retrieval silently died; only a fresh
// `openwolf init` deployed the full set. The three callers now share a single
// HOOK_FILES constant (src/cli/hook-files.ts). This test imports that SAME
// constant and asserts every entry lands on disk, so the lists can never
// drift again AND the deploy loop (incl. subdir mkdir) is exercised directly
// without touching the global project registry.

import { copyHookScripts } from "../dist/src/cli/update.js";
import { HOOK_FILES } from "../dist/src/cli/hook-files.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

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

// The historically-missing four (OPT-31/44): update.ts deployed only 7; these
// were dropped, breaking stop.js's runPrune/buildIndex imports after update.
const HISTORICALLY_MISSING = [
  "prune.js",
  "retrieval.js",
  "adapters/normalize.js",
  "adapters/codex-v4a.js",
];

const tempWolf = fs.mkdtempSync(path.join(os.tmpdir(), "openwolf-update-deploy-"));
await (async () => {
try {
  copyHookScripts(tempWolf);
  const hooksDir = path.join(tempWolf, "hooks");

  // 1. Every HOOK_FILES entry lands on disk — proves the deploy loop + the
  //    subdir mkdir fix (adapter entries would ENOENT without it).
  for (const file of HOOK_FILES) {
    assert(fs.existsSync(path.join(hooksDir, file)), `deployed: ${file}`);
  }

  // 2. The historically-missing four, called out explicitly (regression intent).
  for (const file of HISTORICALLY_MISSING) {
    assert(fs.existsSync(path.join(hooksDir, file)), `regression-guard present: ${file}`);
  }

  // 3. adapters/ subdirectory was created (the ENOENT trap the old loop hit).
  assert(fs.existsSync(path.join(hooksDir, "adapters")), "adapters/ subdirectory created");

  // 4. No stray files: every .js on disk is a HOOK_FILES entry (no partial /
  //    leftover deploy). Walks subdirs; normalizes Windows backslashes.
  const onDisk = [];
  function walk(dir, rel = "") {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), relPath);
      } else if (entry.name.endsWith(".js")) {
        onDisk.push(relPath.replace(/\\/g, "/"));
      }
    }
  }
  walk(hooksDir);
  const expected = new Set(HOOK_FILES);
  const extra = onDisk.filter((f) => !expected.has(f));
  assert(
    extra.length === 0,
    `no stray files (on-disk=${onDisk.length}, expected=${HOOK_FILES.length}, extra=${extra.join(",") || "none"})`,
  );
  assert(onDisk.length === HOOK_FILES.length, `count match: ${onDisk.length} === ${HOOK_FILES.length}`);

  // 5. hooks/package.json with type:module (ESM hooks requirement).
  const pkg = JSON.parse(fs.readFileSync(path.join(hooksDir, "package.json"), "utf-8"));
  assert(pkg.type === "module", "hooks/package.json has type:module");

  // 6. BEHAVIOURAL: the deployed shared.js must actually load — its relative
  //    imports (./descriptions/known.js, ./adapters/normalize.js, ...) must
  //    resolve against the ON-DISK deploy, not the source tree. This is the
  //    anti-false-green check: the file-presence assertions above stayed green
  //    even when HOOK_FILES forgot descriptions/*.js (OPT-33 P0 gap), because
  //    they only checked the entries in the list, not whether shared.js could
  //    import its own dependencies. Loading shared.js makes a missing submodule
  //    throw ERR_MODULE_NOT_FOUND immediately. extractDescription is exported,
  //    so a successful load + typeof check proves the whole import graph is
  //    deployed.
  const sharedUrl = pathToFileURL(path.join(hooksDir, "shared.js")).href;
  let loaded = null;
  try {
    loaded = await import(sharedUrl);
  } catch (e) {
    assert(false, `deployed shared.js loads (import graph complete): ${e.code || e.message}`);
  }
  if (loaded) {
    assert(typeof loaded.extractDescription === "function",
      "deployed shared.js exports extractDescription (import graph complete)");
  }
} finally {
  fs.rmSync(tempWolf, { recursive: true, force: true });
}
})();

console.log(`\nG-update-deploy: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
