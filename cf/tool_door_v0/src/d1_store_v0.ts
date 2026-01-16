/**
 * D1 Store helpers for Tool Door tables
 */

export class D1Store {
  constructor(private db: D1Database) {}

  /**
   * Insert a new evidence record
   */
  async insertEvidence(
    id: string,
    ts: number,
    verb: string,
    requestJson: string,
    resultJson: string,
    resultCoreHash: string
  ): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO evidence (id, ts, verb, request_json, result_json, result_core_hash) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(id, ts, verb, requestJson, resultJson, resultCoreHash)
      .run();
  }

  /**
   * Insert a new policy trail record
   */
  async insertPolicyTrail(
    id: string,
    ts: number,
    decisionsJson: string
  ): Promise<void> {
    await this.db
      .prepare('INSERT INTO policy_trail (id, ts, decisions_json) VALUES (?, ?, ?)')
      .bind(id, ts, decisionsJson)
      .run();
  }

  /**
   * Insert a new idempotency record
   */
  async insertIdempotencyRecord(
    key: string,
    ts: number,
    outcomeCode: string,
    evidenceId: string,
    resultCoreHash: string
  ): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO idempotency (key, ts, outcome_code, evidence_id, result_core_hash) VALUES (?, ?, ?, ?, ?)'
      )
      .bind(key, ts, outcomeCode, evidenceId, resultCoreHash)
      .run();
  }

  /**
   * Insert or update a throttle record (UPSERT)
   */
  async insertThrottleRecord(key: string, ts: number): Promise<void> {
    await this.db
      .prepare('INSERT INTO throttle (key, ts) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET ts = excluded.ts')
      .bind(key, ts)
      .run();
  }

  /**
   * Get an idempotency record by key
   */
  async getIdempotencyRecord(key: string): Promise<{ 
    key: string; 
    ts: number; 
    outcome_code: string; 
    evidence_id: string | null; 
    result_core_hash: string | null; 
  } | null> {
    const result = await this.db
      .prepare('SELECT * FROM idempotency WHERE key = ?')
      .bind(key)
      .first();
    
    return result as any;
  }

  /**
   * Get a throttle record by key
   */
  async getThrottleRecord(key: string): Promise<{ key: string; ts: number } | null> {
    const result = await this.db
      .prepare('SELECT * FROM throttle WHERE key = ?')
      .bind(key)
      .first();
    
    return result as any;
  }
}