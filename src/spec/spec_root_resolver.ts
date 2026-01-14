import fs from 'fs-extra';
import path from 'path';

export interface MovaSpecPaths {
  specRoot: string;
  schemasDir: string;
}

/**
 * Resolve @leryk1981/mova-spec installation and locate schema directory.
 * Throws a clear error if package is missing or layout is unexpected.
 */
export function resolveMovaSpecRoot(): MovaSpecPaths {
  let pkgJsonPath: string;
  try {
    pkgJsonPath = require.resolve('@leryk1981/mova-spec/package.json');
  } catch (e: any) {
    throw new Error(
      `SPEC_NOT_FOUND: @leryk1981/mova-spec is not installed or resolvable (${e?.message || e})`
    );
  }

  const specRoot = path.dirname(pkgJsonPath);
  const candidates = new Set<string>();

  // Common case: schemas/ at package root
  candidates.add(path.join(specRoot, 'schemas'));

  // Also inspect first-level subdirectories for a schemas/ folder
  const entries = fs.readdirSync(specRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      candidates.add(path.join(specRoot, entry.name, 'schemas'));
    }
  }

  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      const files = fs.readdirSync(dir);
      if (files.some((f) => f.endsWith('.schema.json'))) {
        return { specRoot, schemasDir: dir };
      }
    }
  }

  throw new Error(
    `SPEC_LAYOUT_UNSUPPORTED: cannot find schemas/ in @leryk1981/mova-spec (checked ${[
      ...candidates,
    ].join(', ')})`
  );
}
