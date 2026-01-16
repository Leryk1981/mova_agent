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
  const basePayload = {
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
    }
  };

  // First request with idempotency key A
  const payloadA = {
    ...basePayload,
    idempotency_key: 'smoke-test-' + Date.now() + '-a'
  };

  console.log('Making first request...');
  const responseA = await fetch(`${toolDoorUrl}/tool/deliver`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${toolDoorToken}`
    },
    body: JSON.stringify(payloadA)
  });

  const receiptA = await responseA.json();
  console.log(`First request - Status: ${responseA.status}, Receipt:`, receiptA);

  // Second request with different idempotency key B (within cooldown period)
  const payloadB = {
    ...basePayload,
    idempotency_key: 'smoke-test-' + Date.now() + '-b'  // Different idempotency key
  };

  console.log('Making second request (different idempotency key, within cooldown)...');
  const responseB = await fetch(`${toolDoorUrl}/tool/deliver`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${toolDoorToken}`
    },
    body: JSON.stringify(payloadB)
  });

  const receiptB = await responseB.json();
  console.log(`Second request - Status: ${responseB.status}, Receipt:`, receiptB);

  // Both requests should return proper receipts (no 500/1101 errors)
  const bothSuccessful = responseA.status >= 200 && responseA.status < 500 &&
                         responseB.status >= 200 && responseB.status < 500;

  // Create evidence file with the receipts
  const smokeEvidence = {
    status: bothSuccessful ? 'COMPLETED' : 'PARTIAL',
    timestamp: new Date().toISOString(),
    requestA: payloadA,
    responseA_status: responseA.status,
    receiptA: receiptA,
    requestB: payloadB,
    responseB_status: responseB.status,
    receiptB: receiptB,
    both_requests_successful: bothSuccessful,
    tool_door_url: toolDoorUrl,
    test_webhook_url: testWebhookUrl
  };

  // Create directory if it doesn't exist
  const evidenceDir = path.join('artifacts', 'smoke', 'tool_door_v0', new Date().toISOString().split('T')[0]);
  await fs.mkdir(evidenceDir, { recursive: true });

  const evidenceFilePath = path.join(evidenceDir, 'smoke_evidence.json');
  await fs.writeFile(evidenceFilePath, JSON.stringify(smokeEvidence, null, 2));

  if (bothSuccessful) {
    console.log('Smoke test completed successfully! Both requests handled properly.');
  } else {
    console.log('Smoke test partially completed - at least one request had an issue.');
  }

  console.log(`First request status: ${responseA.status}`);
  console.log(`Second request status: ${responseB.status}`);
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