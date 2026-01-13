// @ts-nocheck
const path = require('path');
const fs = require('fs');
(async function () {
  try {
    const epPath = path.join(
      'artifacts',
      'mova_agent',
      'req_89228ac4-6377-469b-9972-25e3f643382a',
      'runs',
      'run_dba1cec9-de6a-41d7-98de-5c7cce822dc0',
      'episodes',
      'sec_1768237057635_v3gpy8yex.json'
    );
    const ep = JSON.parse(fs.readFileSync(epPath, 'utf8'));
    console.log('Loaded episode:', ep.episode_id, ep.episode_type);

    // Inline referenced schema to produce a merged schema for debugging
    const Ajv = require('ajv');
    const ajv = new Ajv({ allErrors: true, strict: false });
    const securitySchemaPath = path.join(
      'vendor',
      'MOVA',
      'schemas',
      'ds.security_event_episode_core_v1.schema.json'
    );
    const movaEpisodePath = path.join(
      'vendor',
      'MOVA',
      'schemas',
      'ds.mova_episode_core_v1.schema.json'
    );
    const securitySchema = JSON.parse(fs.readFileSync(securitySchemaPath, 'utf8'));
    const movaEpisodeSchema = JSON.parse(fs.readFileSync(movaEpisodePath, 'utf8'));
    // Replace $ref in allOf with actual content for debugging
    if (securitySchema.allOf && Array.isArray(securitySchema.allOf)) {
      for (let i = 0; i < securitySchema.allOf.length; i++) {
        const item = securitySchema.allOf[i];
        if (item.$ref && item.$ref.includes('ds.mova_episode_core_v1')) {
          securitySchema.allOf[i] = movaEpisodeSchema;
        }
      }
    }
    // Remove $schema to avoid meta-schema resolution issues in this ad-hoc AJV instance
    delete securitySchema.$schema;
    delete movaEpisodeSchema.$schema;
    const validateFunc = ajv.compile(securitySchema);
    const ok = validateFunc(ep);
    console.log('compiled ok=', ok);
    console.log('errors:', JSON.stringify(validateFunc.errors, null, 2));
  } catch (e) {
    console.error('Error during debug:', e);
    process.exit(2);
  }
})();
