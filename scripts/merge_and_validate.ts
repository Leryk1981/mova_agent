// @ts-nocheck
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

function loadVendorSchema(id) {
  const vendorDir = path.join('vendor', 'MOVA', 'schemas');
  const file = path.join(vendorDir, `${id}.schema.json`);
  if (!fs.existsSync(file)) throw new Error(`vendor schema not found: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveRefsRec(obj, seen = new Set()) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((i) => resolveRefsRec(i, seen));
  if (obj.$ref && typeof obj.$ref === 'string') {
    const ref = obj.$ref;
    if (ref.startsWith('https://mova.dev/schemas/') && ref.endsWith('.schema.json')) {
      const id = ref.split('/').pop().replace('.schema.json', '');
      if (seen.has(id)) return {}; // avoid cycles
      seen.add(id);
      const schema = loadVendorSchema(id);
      return resolveRefsRec(Object.assign({}, schema), seen);
    }
  }
  const out = {};
  for (const k of Object.keys(obj)) {
    out[k] = resolveRefsRec(obj[k], seen);
  }
  return out;
}

(async () => {
  try {
    const epPath = path.join(
      'artifacts',
      'mova_agent',
      'req_0f293ffc-ab26-44a9-ad36-ccdc282b68ff',
      'runs',
      'run_32b12802-d46f-48be-91ec-4e45e8df6be0',
      'episodes',
      'sec_1768237790072_ba5x8medc.json'
    );
    const ep = JSON.parse(fs.readFileSync(epPath, 'utf8'));
    const securitySchema = loadVendorSchema('ds.security_event_episode_core_v1');
    const merged = resolveRefsRec(securitySchema);
    // remove $schema
    delete merged.$schema;
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(merged);
    const ok = validate(ep);
    console.log('valid=', ok);
    console.log('errors=', JSON.stringify(validate.errors, null, 2));
  } catch (e) {
    console.error('ERR', e.message, e.stack);
  }
})();
