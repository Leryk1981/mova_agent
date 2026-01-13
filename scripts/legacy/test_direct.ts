// @ts-nocheck
const fs = require('fs').promises;

async function testDirect() {
  console.log('Testing direct schema access...');

  try {
    const connectorData = await fs.readFile(
      './vendor/MOVA/schemas/ds.connector_core_v1.schema.json',
      'utf8'
    );
    const connectorSchema = JSON.parse(connectorData);
    console.log('✓ Connector schema found, ID:', connectorSchema.$id);
  } catch (error) {
    console.log('x Connector schema error:', error.message);
  }

  try {
    const episodeData = await fs.readFile(
      './vendor/MOVA/schemas/ds.mova_episode_core_v1.schema.json',
      'utf8'
    );
    const episodeSchema = JSON.parse(episodeData);
    console.log('✓ Episode schema found, ID:', episodeSchema.$id);
  } catch (error) {
    console.log('x Episode schema error:', error.message);
  }
}

testDirect();
