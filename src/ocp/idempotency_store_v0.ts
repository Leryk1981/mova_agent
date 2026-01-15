import fs from 'fs-extra';
import path from 'path';
import { createHash } from 'crypto';

export interface IdempotencyRecord {
  payload_sha256: string;
  first_evidence_path: string;
  created_at_ms: number;
}

export interface StoreLoadResult {
  map: Record<string, IdempotencyRecord>;
  path: string;
}

const DEFAULT_STORE_PATH = path.join('artifacts', 'ocp_idempotency_store_v0', 'store.json');

function getStorePath(): string {
  return process.env.OCP_IDEMPOTENCY_STORE_PATH || DEFAULT_STORE_PATH;
}

async function loadStore(): Promise<StoreLoadResult> {
  const storePath = getStorePath();
  if (!(await fs.pathExists(storePath))) {
    return { map: {}, path: storePath };
  }
  try {
    const data = await fs.readJson(storePath);
    return { map: data || {}, path: storePath };
  } catch {
    return { map: {}, path: storePath };
  }
}

async function saveStore(storePath: string, map: Record<string, IdempotencyRecord>): Promise<void> {
  const tmpPath = `${storePath}.tmp`;
  await fs.ensureDir(path.dirname(storePath));
  await fs.writeJson(tmpPath, map, { spaces: 2 });
  try {
    await fs.move(tmpPath, storePath, { overwrite: true });
  } catch {
    // Best effort fallback
    await fs.copy(tmpPath, storePath, { overwrite: true });
    await fs.remove(tmpPath).catch(() => {});
  }
}

export class IdempotencyStoreV0 {
  private map: Record<string, IdempotencyRecord> = {};
  private storePath: string = getStorePath();

  async init(): Promise<void> {
    const { map, path: storePath } = await loadStore();
    this.map = map;
    this.storePath = storePath;
  }

  static hashPayload(payload: any): string {
    return createHash('sha256')
      .update(JSON.stringify(payload ?? {}), 'utf8')
      .digest('hex');
  }

  get(key: string): IdempotencyRecord | undefined {
    return this.map[key];
  }

  async record(
    key: string,
    payloadSha256: string,
    evidencePath: string,
    timestampMs: number
  ): Promise<void> {
    this.map[key] = {
      payload_sha256: payloadSha256,
      first_evidence_path: evidencePath,
      created_at_ms: timestampMs,
    };
    await saveStore(this.storePath, this.map);
  }
}

export const IDEMPOTENCY_ERRORS = {
  MISSING_IDEMPOTENCY_KEY: 'MISSING_IDEMPOTENCY_KEY',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  SUPPRESSED_DUPLICATE: 'SUPPRESSED_DUPLICATE',
} as const;
