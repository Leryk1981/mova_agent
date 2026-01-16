import fs from 'fs-extra';
import path from 'path';

type RateLimitMap = Record<string, number>;

function loadStore(storePath: string): RateLimitMap {
  if (!fs.existsSync(storePath)) {
    return {};
  }
  try {
    const data = fs.readJsonSync(storePath);
    return typeof data === 'object' && data ? (data as RateLimitMap) : {};
  } catch {
    return {};
  }
}

function saveStore(storePath: string, map: RateLimitMap): void {
  const tmpPath = `${storePath}.tmp`;
  fs.ensureDirSync(path.dirname(storePath));
  fs.writeJsonSync(tmpPath, map, { spaces: 2 });
  try {
    fs.moveSync(tmpPath, storePath, { overwrite: true });
  } catch {
    fs.copySync(tmpPath, storePath, { overwrite: true });
    try {
      fs.removeSync(tmpPath);
    } catch {
      // Best effort cleanup.
    }
  }
}

export class RateLimitStoreV0 {
  private map: RateLimitMap;
  private storePath: string;

  constructor(storePath: string) {
    this.storePath = storePath;
    this.map = loadStore(storePath);
  }

  getLastSent(key: string): number | null {
    const value = this.map[key];
    return typeof value === 'number' ? value : null;
  }

  setLastSent(key: string, tsMs: number): void {
    this.map[key] = tsMs;
    saveStore(this.storePath, this.map);
  }
}
