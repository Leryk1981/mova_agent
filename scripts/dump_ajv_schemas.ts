// @ts-nocheck
const loader = require('../build/src/ajv/ajv_loader');
(async () => {
  try {
    await loader.ajvLoader.registerSchema('ds.security_event_episode_core_v1');
    const ajv = loader.ajvLoader.ajv;
    const keys = Object.keys(ajv.schemas || {});
    console.log('ajv schemas keys count:', keys.length);
    console.log(keys.slice(0, 50));
    const vf =
      ajv.getSchema('ds.security_event_episode_core_v1') ||
      ajv.getSchema('https://mova.dev/schemas/ds.security_event_episode_core_v1.schema.json');
    console.log('validator found:', !!vf);
    if (vf) {
      console.log('schema id from validator:', vf.schema && vf.schema.$id);
    }
  } catch (e) {
    console.error('error:', e.message);
  }
})();
