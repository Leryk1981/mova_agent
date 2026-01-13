const fs = require("fs");
const path = require("path");

function readJson(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return JSON.parse(content);
}

function parseMatrixRow(matrixPath) {
  const content = fs.readFileSync(matrixPath, "utf8");
  const lines = content.split("\n").filter((line) => line.trim().startsWith("|"));
  // Expect: header, separator, then data rows; take the first data row
  const dataRows = lines.filter((line) => !line.includes("---")).slice(1);
  if (!dataRows.length) {
    throw new Error("No data rows found in compatibility matrix");
  }
  const cells = dataRows[0].split("|").map((c) => c.trim()).filter(Boolean);
  if (cells.length < 3) {
    throw new Error("Matrix row does not contain required columns");
  }
  return {
    agent: cells[0],
    cli: cells[1],
    schema: cells[2],
  };
}

function main() {
  const root = path.resolve(__dirname, "..");
  const matrixPath = path.join(root, "COMPATIBILITY_MATRIX.md");
  if (!fs.existsSync(matrixPath)) {
    console.error("Missing COMPATIBILITY_MATRIX.md");
    process.exit(1);
  }

  const agentPkg = readJson(path.join(root, "package.json"));
  const cliPkg = readJson(path.join(root, "sdk-cli", "package.json"));
  const schemaVersion =
    (cliPkg.dependencies && cliPkg.dependencies["@leryk1981/mova-spec"]) ||
    (agentPkg.dependencies && agentPkg.dependencies["@leryk1981/mova-spec"]);

  if (!schemaVersion) {
    console.error("Cannot determine @leryk1981/mova-spec version from package.json files");
    process.exit(1);
  }

  const row = parseMatrixRow(matrixPath);

  const mismatches = [];
  if (row.agent !== agentPkg.version) {
    mismatches.push(`mova_agent version mismatch: matrix=${row.agent}, package.json=${agentPkg.version}`);
  }
  if (row.cli !== cliPkg.version) {
    mismatches.push(`mova-sdk-cli version mismatch: matrix=${row.cli}, sdk-cli/package.json=${cliPkg.version}`);
  }
  // Normalize schema version strings (strip leading ^ or ~)
  const normalize = (v) => v.replace(/^[^0-9]*/, "");
  if (normalize(row.schema) !== normalize(schemaVersion)) {
    mismatches.push(
      `schema-set version mismatch: matrix=${row.schema}, package.json=${schemaVersion}`
    );
  }

  if (mismatches.length) {
    console.error("Compatibility matrix is out of date:");
    mismatches.forEach((m) => console.error(`- ${m}`));
    console.error("Please update COMPATIBILITY_MATRIX.md to match current package versions.");
    process.exit(1);
  }

  console.log("Compatibility matrix is up to date.");
}

main();
