# @leryk1981/mova-executors

Restricted shell and HTTP drivers for MOVA runtimes with allowlists and timeouts. Dual ESM/CJS builds, TypeScript-first.

## Quickstart
```ts
import { httpDriverFactory, restrictedShellDriverFactory } from "@leryk1981/mova-executors";

const http = httpDriverFactory();
await http.execute({ url: "https://example.com" }, { allowlist: ["https://example.com"] });

const shell = restrictedShellDriverFactory();
await shell.execute({ command: "node", args: ["-v"] }, { allowlist: ["node"] });
```

## Boundaries
- No deploy or cloud providers included (Cloudflare/OpenCode/gateways are out of scope).
- No binaries or CLI.
- Safe-by-default: allowlist + timeout hooks; no secrets baked in.
