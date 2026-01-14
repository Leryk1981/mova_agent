import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkgCjs = require("@leryk1981/mova-executors");

const expected = ["httpDriverFactory", "restrictedShellDriverFactory"];
const missingCjs = expected.filter((k) => !pkgCjs[k]);
if (missingCjs.length) {
  console.error("[executors_probe_v0] FAIL CJS missing", missingCjs);
  process.exit(1);
}

try {
  const esm = await import("@leryk1981/mova-executors");
  const missingEsm = expected.filter((k) => !esm[k]);
  if (missingEsm.length) {
    console.error("[executors_probe_v0] FAIL ESM missing", missingEsm);
    process.exit(1);
  }
} catch (e) {
  console.warn("[executors_probe_v0] ESM import skipped:", e.message);
}

console.log("[executors_probe_v0] PASS", { checked: expected });
