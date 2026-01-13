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
    const validate = require('../build/src/ajv/ajv_loader').validate;
    const res = await validate('ds.security_event_episode_core_v1', ep);
    console.log('validate result:');
    console.log(JSON.stringify(res, null, 2));
  } catch (e) {
    console.error('Error during debug2:', e);
  }
})();
