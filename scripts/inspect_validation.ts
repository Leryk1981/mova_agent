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
    console.log('Episode object:', JSON.stringify(sec, null, 2));

    const ajvLoader = require('../build/src/ajv/ajv_loader');
    const validate = ajvLoader.validate;
    const ajvInst = ajvLoader.ajvLoader.getAjv;

    const v = await validate('ds.security_event_episode_core_v1', sec);
    console.log('validate() returned:', v);

    const validateFunc =
      ajvInst.getSchema('ds.security_event_episode_core_v1') ||
      ajvInst.getSchema('https://mova.dev/schemas/ds.security_event_episode_core_v1.schema.json');
    console.log('Compiled validator present?:', !!validateFunc);
    if (validateFunc) {
      const ok = validateFunc(sec);
      console.log('validateFunc result:', ok);
      console.log('validateFunc.errors:', JSON.stringify(validateFunc.errors, null, 2));
    }

    // Also attempt to compile merged schema manually for more context
    const loader = ajvLoader.ajvLoader;
    console.log('Loaded schema keys in cache:', loader.getLoadedSchemas());
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(2);
  }
})();
