import { ajvLoader } from './src/ajv/ajv_loader';
import { SchemaRegistry } from './src/ajv/schema_registry';

async function testMinimalPlan() {
  console.log('Testing minimal plan validation with Ajv...');

  try {
    // Create schema registry and load all schemas
    const registry = new SchemaRegistry(ajvLoader);
    await registry.loadAllSchemas();

    // Create a minimal plan envelope that should comply with env.mova_agent_plan_v1
    const minimalPlan = {
      verb: 'execute',
      subject_ref: 'user_request',
      object_ref: 'execution_plan',
      payload: {
        steps: [],
      },
    };

    const result = await ajvLoader.validate('env.mova_agent_plan_v1', minimalPlan);

    if (result.ok) {
      console.log('✓ Minimal plan validated successfully against env.mova_agent_plan_v1');
      console.log('Validation passed!');
    } else {
      console.log('✗ Validation failed:');
      console.log('Errors:', result.errors);
    }
  } catch (error) {
    console.log('✗ Validation threw an error:', error.message);
  }
}

testMinimalPlan().catch(console.error);
