// @ts-nocheck
const { ajvLoader } = require('./build/src/ajv/ajv_loader');

async function testSchemaLoading() {
  console.log('Testing schema loading functionality...');

  try {
    console.log('Testing ds.connector_core_v1 schema loading...');
    const connectorSchemaExists = await ajvLoader.schemaExists('ds.connector_core_v1');
    console.log('ds.connector_core_v1 exists: ' + connectorSchemaExists);

    if (connectorSchemaExists) {
      console.log('SUCCESS: ds.connector_core_v1 schema found');
    } else {
      console.log('ERROR: ds.connector_core_v1 schema not found!');
    }

    console.log('Testing ds.mova_episode_core_v1 schema loading...');
    const episodeSchemaExists = await ajvLoader.schemaExists('ds.mova_episode_core_v1');
    console.log('ds.mova_episode_core_v1 exists: ' + episodeSchemaExists);

    if (episodeSchemaExists) {
      console.log('SUCCESS: ds.mova_episode_core_v1 schema found');
    } else {
      console.log('ERROR: ds.mova_episode_core_v1 schema not found!');
    }

    console.log('Test completed');
    return true;
  } catch (error) {
    console.error('Error:', error);
    return false;
  }
}

testSchemaLoading().then(function (result) {
  console.log('Final result:', result);
});
