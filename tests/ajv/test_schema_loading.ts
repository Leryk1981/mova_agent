// @ts-nocheck
const { ajvLoader } = require('../build/src/ajv/ajv_loader');

async function testSchemaLoading() {
  console.log('Testing schema loading functionality...');

  try {
    console.log('\n1. Testing ds.connector_core_v1 schema loading...');
    const connectorSchemaExists = await ajvLoader.schemaExists('ds.connector_core_v1');
    console.log(`   ds.connector_core_v1 exists: ${connectorSchemaExists}`);

    if (connectorSchemaExists) {
      console.log('   Successfully loaded ds.connector_core_v1 schema');
      const connectorSchema = await ajvLoader.loadSchema('ds.connector_core_v1');
      console.log(`   Schema ID: ${connectorSchema.$id}`);
      console.log(`   Schema title: ${connectorSchema.title || 'N/A'}`);
    } else {
      console.log('   ERROR: ds.connector_core_v1 schema not found!');
    }

    console.log('\n2. Testing ds.mova_episode_core_v1 schema loading...');
    const episodeSchemaExists = await ajvLoader.schemaExists('ds.mova_episode_core_v1');
    console.log(`   ds.mova_episode_core_v1 exists: ${episodeSchemaExists}`);

    if (episodeSchemaExists) {
      console.log('   Successfully loaded ds.mova_episode_core_v1 schema');
      const episodeSchema = await ajvLoader.loadSchema('ds.mova_episode_core_v1');
      console.log(`   Schema ID: ${episodeSchema.$id}`);
      console.log(`   Schema title: ${episodeSchema.title || 'N/A'}`);
    } else {
      console.log('   ERROR: ds.mova_episode_core_v1 schema not found!');
    }

    console.log('\n3. All loaded schemas:', ajvLoader.getLoadedSchemas());
    console.log('\nSchema loading test completed successfully!');
  } catch (error) {
    console.error('Error during schema loading test:', error);
  }
}

testSchemaLoading();
