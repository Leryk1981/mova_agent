import { createRequire } from 'module';

// Minimal smoke to ensure core-engine dual exports are consumable via CJS require.
const require = createRequire(import.meta.url);
const core = require('@leryk1981/mova-core-engine');

const expected = ['AjvSchemaLoader', 'SchemaRegistry', 'PolicyEngine', 'EvidenceWriter', 'EpisodeWriter'];
const missing = expected.filter((name) => !core[name]);

if (missing.length > 0) {
  console.error('[core_engine_probe_v0] FAIL missing exports:', missing);
  process.exit(1);
}

console.log('[core_engine_probe_v0] PASS exports present:', expected.join(', '));
