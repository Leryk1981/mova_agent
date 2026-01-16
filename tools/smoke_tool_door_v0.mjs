#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';

// Check if required environment variables are set
const toolDoorUrl = process.env.TOOL_DOOR_URL;
const toolDoorToken = process.env.TOOL_DOOR_TOKEN;
const testWebhookUrl = process.env.TEST_WEBHOOK_URL;

// If any required environment variable is missing, SKIP with evidence
if (!toolDoorUrl || !toolDoorToken || !testWebhookUrl) {
  console.log('SKIP: Missing required environment variables (TOOL_DOOR_URL, TOOL_DOOR_TOKEN, TEST_WEBHOOK_URL)');
  
  // Create evidence file
  const smokeEvidence = {
    status: 'SKIPPED',
    reason: 'Missing required environment variables',
    timestamp: new Date().toISOString(),
    env_vars_present: {
      TOOL_DOOR_URL: !!toolDoorUrl,
      TOOL_DOOR_TOKEN: !!toolDoorToken && toolDoorToken.length > 0,
      TEST_WEBHOOK_URL: !!testWebhookUrl
    }
  };
  
  // Create directory if it doesn't exist
  const evidenceDir = path.join('artifacts', 'smoke', 'tool_door_v0', new Date().toISOString().split('T')[0]);
  await fs.mkdir(evidenceDir, { recursive: true });
  
  const evidenceFilePath = path.join(evidenceDir, 'smoke_evidence.json');
  await fs.writeFile(evidenceFilePath, JSON.stringify(smokeEvidence, null, 2));
  
  console.log(`Evidence written to: ${evidenceFilePath}`);
  process.exit(0);
}

try {
  console.log('Starting smoke test for MOVA Tool Door v0...');
  
  // Prepare the request payload for deliver verb
  const payload = {
    policy_profile_id: 'dev_local_v0',
    request: {
      target_url: testWebhookUrl,
      message: 'Test message from MOVA Tool Door smoke test',
      headers: {
        'X-Test-Source': 'mova-tool-door-smoke-test'
      }
    },
    context: {
      test_id: 'smoke-test-deliver-' + Date.now(),
      timestamp: new Date().toISOString()
    },
    idempotency_key: 'smoke-test-' + Date.now()
  };
  
  // Make the request to the tool door
  const response = await fetch(`${toolDoorUrl}/tool/deliver`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${toolDoorToken}`
    },
    body: JSON.stringify(payload)
  });
  
  const receipt = await response.json();
  
  // Create evidence file with the receipt
  const smokeEvidence = {
    status: 'COMPLETED',
    timestamp: new Date().toISOString(),
    request: payload,
    response_status: response.status,
    receipt: receipt,
    tool_door_url: toolDoorUrl,
    test_webhook_url: testWebhookUrl
  };
  
  // Create directory if it doesn't exist
  const evidenceDir = path.join('artifacts', 'smoke', 'tool_door_v0', new Date().toISOString().split('T')[0]);
  await fs.mkdir(evidenceDir, { recursive: true });
  
  const evidenceFilePath = path.join(evidenceDir, 'smoke_evidence.json');
  await fs.writeFile(evidenceFilePath, JSON.stringify(smokeEvidence, null, 2));
  
  console.log('Smoke test completed successfully!');
  console.log(`Response status: ${response.status}`);
  console.log(`Receipt:`, receipt);
  console.log(`Evidence written to: ${evidenceFilePath}`);
} catch (error) {
  console.error('Smoke test failed:', error.message);
  
  // Create failure evidence
  const smokeEvidence = {
    status: 'FAILED',
    timestamp: new Date().toISOString(),
    error: error.message,
    stack: error.stack,
    tool_door_url: toolDoorUrl,
    test_webhook_url: testWebhookUrl
  };
  
  // Create directory if it doesn't exist
  const evidenceDir = path.join('artifacts', 'smoke', 'tool_door_v0', new Date().toISOString().split('T')[0]);
  await fs.mkdir(evidenceDir, { recursive: true });
  
  const evidenceFilePath = path.join(evidenceDir, 'smoke_evidence.json');
  await fs.writeFile(evidenceFilePath, JSON.stringify(smokeEvidence, null, 2));
  
  console.log(`Failure evidence written to: ${evidenceFilePath}`);
  process.exit(1);
}