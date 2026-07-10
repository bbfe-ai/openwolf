// Spawned by test/ledger-prune-test.mjs in a FRESH node process so readConfig()'s
// module-level _configCache does not leak between scenarios. CLAUDE_PROJECT_DIR
// points the hooks at the temp project; runPrune reads .wolf/config.json from
// there and caps .wolf/token-ledger.json. The parent asserts on the on-disk
// result after this process exits (no IPC needed).
import { runPrune } from "../dist/hooks/prune.js";
import * as path from "node:path";
const wolfDir = path.join(process.env.CLAUDE_PROJECT_DIR, ".wolf");
runPrune(wolfDir);
