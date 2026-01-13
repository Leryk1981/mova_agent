// @ts-nocheck
const AjvLoaderSrc = require('../src/ajv/ajv_loader');
const { getLogger } = require('../src/logging/logger');

(async () => {
  const logger = getLogger();
  const loader = new AjvLoaderSrc.AjvSchemaLoader();
  const schemaId = 'ds.security_event_episode_core_v1';
  logger.info(`Checking paths for ${schemaId}`);
  await loader
    .loadSchema(schemaId)
    .then((sch) => logger.info(`Loaded schema keys: ${Object.keys(sch).join(', ')}`))
    .catch((e) => logger.error(`loadSchema error: ${e.message}`));
})();
