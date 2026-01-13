// @ts-nocheck
const fs = require('fs-extra');
const path = require('path');
(async () => {
  try {
    const indexPath = path.join(
      'artifacts',
      'mova_agent',
      'req_99be755e-3a41-40f6-9be0-6df3829e3f09',
      'runs',
      'run_958577be-c4f1-4149-af40-17aa27daa93c',
      'episodes',
      'index.jsonl'
    );
    const content = await fs.readFile(indexPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const eps = lines.map((l) => JSON.parse(l));
    const sec = eps.find((e) => e.episode_type && e.episode_type.startsWith('security_event'));
    console.log('Found security event:', sec.episode_id, sec.episode_type);

    const ajvLoader = require('../build/src/ajv/ajv_loader');
    const validate = ajvLoader.validate;
    const ajvInst = ajvLoader.ajvLoader.getAjv;

    console.log('AJV registered schema keys:', Object.keys(ajvInst.schemas || {}));
    const s1 = ajvInst.getSchema('ds.security_event_episode_core_v1');
    console.log('getSchema short id:', !!s1);
    // try canonical id from known vendor URL
    const canonical = 'https://mova.dev/schemas/ds.security_event_episode_core_v1.schema.json';
    const s2 = ajvInst.getSchema(canonical);
    console.log('getSchema canonical id:', !!s2);

    const validation = await validate('ds.security_event_episode_core_v1', sec);
    console.log('validate result.ok =', validation.ok);
    console.log('validation.errors raw =', validation.errors);

    if (s1) {
      console.log('Validator (short id) errors:', s1.errors);
    }
    if (s2) {
      console.log('Validator (canonical) errors:', s2.errors);
    }

    process.exit(0);
  } catch (e) {
    console.error('Error in debug script:', e);
    process.exit(2);
  }
})();
