// @ts-nocheck
const loader = require('../build/src/ajv/ajv_loader');
const { getLogger } = require('../src/logging/logger');

(async () => {
  const logger = getLogger();
  const schemaId = 'ds.security_event_episode_core_v1';
  try {
    const schema = await loader.ajvLoader.loadSchema(schemaId);
    logger.info(
      `Loaded schema id: ${schema.$id || '[no $id]'} keys: ${Object.keys(schema).join(', ')}`
    );
  } catch (err) {
    logger.error(`dist loader loadSchema error: ${err.message}`);
  }
})();
