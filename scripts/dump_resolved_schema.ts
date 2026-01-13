// @ts-nocheck
const fs = require('fs-extra');
const path = require('path');
(async () => {
  try {
    const ajvLoader = require('../build/src/ajv/ajv_loader');
    const loader = ajvLoader.ajvLoader;
    const schema = await loader.loadSchema('ds.security_event_episode_core_v1');
    console.log('Loaded schema $id =', schema.$id);
    const resolved = await loader.resolveRefs(schema);
    await fs.ensureDir('tmp');
    await fs.writeJson(path.join('tmp', 'resolved_security_event.json'), resolved, { spaces: 2 });
    console.log('Wrote tmp/resolved_security_event.json');
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(2);
  }
})();
