import { createRequire } from "module";

const require = createRequire(import.meta.url);
const executors = require("@leryk1981/mova-executors");

const { httpDriverFactory, restrictedShellDriverFactory } = executors;

const missing = ["httpDriverFactory", "restrictedShellDriverFactory"].filter((k) => !executors[k]);
if (missing.length) {
  console.error("[executors_probe_v0] FAIL missing exports:", missing);
  process.exit(1);
}

// Restricted shell dry-run (safe)
const shell = restrictedShellDriverFactory();
const shellResult = await shell.execute({ command: "node", args: ["-v"] }, { allowlist: ["node"] });
if (shellResult.exit_code !== 0) {
  console.error("[executors_probe_v0] FAIL shell exit code", shellResult);
  process.exit(1);
}

// HTTP allowlist guard (expect rejection before network)
const http = httpDriverFactory();
let httpGuarded = false;
try {
  await http.execute({ url: "https://example.com" }, { allowlist: ["https://allowed.example"] });
} catch (e) {
  httpGuarded = true;
}
if (!httpGuarded) {
  console.error("[executors_probe_v0] FAIL http allowlist guard");
  process.exit(1);
}

console.log("[executors_probe_v0] PASS", {
  shell: { exit_code: shellResult.exit_code },
  http: "guarded"
});
