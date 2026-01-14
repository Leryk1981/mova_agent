const fs = require("fs");
const path = require("path");

const esmDir = path.join(__dirname, "..", "dist", "esm");
fs.mkdirSync(esmDir, { recursive: true });
const esmIndex = path.join(esmDir, "index.mjs");

const content = `export * from "../cjs/index.js";\n`;
fs.writeFileSync(esmIndex, content);
console.log("[executors] wrote ESM shim ->", esmIndex);
