// @ts-nocheck
const { AjvSchemaLoader } = require('./build/src/ajv/ajv_loader');

async function test() {
  const loader = new AjvSchemaLoader();

  console.log('Testing ds.connector_core_v1 schema loading...');
  try {
    const connectorSchemaExists = await loader.schemaExists('ds.connector_core_v1');
    console.log('ds.connector_core_v1 exists: ' + connectorSchemaExists);

    if (connectorSchemaExists) {
      console.log('Successfully loaded ds.connector_core_v1 schema');
      const connectorSchema = await loader.loadSchema('ds.connector_core_v1');
      console.log('Schema ID: ' + connectorSchema.$id);
      console.log('Schema title: ' + (connectorSchema.title || 'N/A'));
    } else {
      console.log('ERROR: ds.connector_core_v1 schema not found!');
    }

    console.log('\nTesting ds.mova_episode_core_v1 schema loading...');
    const episodeSchemaExists = await loader.schemaExists('ds.mova_episode_core_v1');
    console.log('ds.mova_episode_core_v1 exists: ' + episodeSchemaExists);

    if (episodeSchemaExists) {
      console.log('Successfully loaded ds.mova_episode_core_v1 schema');
      const episodeSchema = await loader.loadSchema('ds.mova_episode_core_v1');
      console.log('Schema ID: ' + episodeSchema.$id);
      console.log('Schema title: ' + (episodeSchema.title || 'N/A'));
    } else {
      console.log('ERROR: ds.mova_episode_core_v1 schema not found!');
    }
  } catch (error) {
    console.error('Error during testing:', error);
  }
}

test().catch(console.error);
