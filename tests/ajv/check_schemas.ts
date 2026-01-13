// @ts-nocheck
const fs = require('fs-extra');
const path = require('path');

async function checkSchemas() {
  console.log('Checking if MOVA schemas exist...');

  const connectorSchemaPath = path.join(
    __dirname,
    '../../vendor/MOVA/schemas',
    'ds.connector_core_v1.schema.json'
  );
  const episodeSchemaPath = path.join(
    __dirname,
    '../../vendor/MOVA/schemas',
    'ds.mova_episode_core_v1.schema.json'
  );

  console.log('Connector schema path:', connectorSchemaPath);
  console.log('Episode schema path:', episodeSchemaPath);

  try {
    const connectorSchema = await fs.readJson(connectorSchemaPath);
    console.log('✓ Connector schema exists, ID:', connectorSchema.$id);
  } catch (error) {
    console.log('x Connector schema error:', error.message);
  }

  try {
    const episodeSchema = await fs.readJson(episodeSchemaPath);
    console.log('✓ Episode schema exists, ID:', episodeSchema.$id);
  } catch (error) {
    console.log('x Episode schema error:', error.message);
  }
}

checkSchemas();
