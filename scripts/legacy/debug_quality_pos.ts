// @ts-nocheck
#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Interpreter } = require('./build/src/interpreter/interpreter');

async function runPositiveQualitySuite() {
  console.log('Running positive quality suite...');

  try {
    // Create a noop-only plan
    const planEnvelope = {
      verb: "execute",
      subject_ref: "user_request",
      object_ref: "execution_plan",
      payload: {
        steps: [{
          id: 'step-1',
          verb: 'noop',
          connector_id: 'noop_connector_1',
          input: { message: 'noop-only step for testing' },
          tool_binding: {
            driver_kind: 'noop',
            limits: {
              timeout_ms: 1000,
              max_data_size: 10240
            }
          }
        }]
      }
    };

    // Create a noop-only tool pool
    const toolPool = {
      tools: [{
        id: 'noop_connector_1',
        connector: { type: 'noop' },
        binding: {
          driver_kind: 'noop',
          limits: {
            timeout_ms: 1000,
            max_data_size: 10240
          }
        }
      }]
    };

    // Create a minimal instruction profile
    const instructionProfile = {
      caps: {
        max_timeout_ms: 10000,
        max_data_size: 102400,
        max_steps: 10
      }
    };

    // Initialize interpreter
    const interpreter = new Interpreter();

    console.log('About to run plan...');
    // Run the plan
    const result = await interpreter.runPlan({
      planEnvelope,
      toolPool,
      instructionProfile
    });
    console.log('Plan execution result:', result);

    // Assertions
    console.log('Checking assertions...');

    // 1. Plan should have exactly 1 step
    if (planEnvelope.payload.steps.length !== 1) {
      throw new Error(`Expected 1 step, got ${planEnvelope.payload.steps.length}`);
    }

    // 2. Verb/driver should be noop
    if (planEnvelope.payload.steps[0].verb !== 'noop' || planEnvelope.payload.steps[0].tool_binding.driver_kind !== 'noop') {
      throw new Error(`Expected noop verb/driver, got ${planEnvelope.payload.steps[0].verb}/${planEnvelope.payload.steps[0].tool_binding.driver_kind}`);
    }

    // 3. No HTTP steps should be present
    const hasHttpSteps = planEnvelope.payload.steps.some(step => step.verb === 'http');
    if (hasHttpSteps) {
      throw new Error('Plan contains HTTP steps, expected noop-only');
    }

    // 4. No shell steps should be present
    const hasShellSteps = planEnvelope.payload.steps.some(step => step.verb === 'shell' || step.verb === 'restricted_shell');
    if (hasShellSteps) {
      throw new Error('Plan contains shell steps, expected noop-only');
    }

    // 5. Check that result indicates success
    if (!result.success) {
      throw new Error(`Expected successful execution, got failure: ${result.error}`);
    }

    // 6. Check that run summary was created with completed status
    if (!result.run_summary || result.run_summary.status !== 'completed') {
      throw new Error(`Expected run summary with completed status, got ${JSON.stringify(result.run_summary)}`);
    }

    // 7. Find the actual evidence directory created by the interpreter
    // The interpreter creates evidence in artifacts/mova_agent/<request_id>/runs/<run_id>/
    const evidenceBaseDir = 'artifacts/mova_agent';
    const evidenceDirs = await fs.readdir(evidenceBaseDir).catch(() => []);

    let foundEvidenceDir = null;
    for (const reqDir of evidenceDirs) {
      const reqPath = path.join(evidenceBaseDir, reqDir);
      if ((await fs.stat(reqPath)).isDirectory()) {
        const runsPath = path.join(reqPath, 'runs');
        if (await fs.pathExists(runsPath)) {
          const runDirs = await fs.readdir(runsPath);
          if (runDirs.length > 0) {
            foundEvidenceDir = path.join(runsPath, runDirs[0]);
            break;
          }
        }
      }
    }

    if (!foundEvidenceDir) {
      throw new Error('Evidence directory was not created by interpreter');
    }

    console.log(`Found evidence directory: ${foundEvidenceDir}`);

    // 8. Check that episodes directory exists
    const episodesDir = path.join(foundEvidenceDir, 'episodes');
    if (!await fs.pathExists(episodesDir)) {
      throw new Error(`Episodes directory does not exist: ${episodesDir}`);
    }

    // 9. Check that run summary was created
    const runSummaryPath = path.join(foundEvidenceDir, 'run_summary.json');
    if (!await fs.pathExists(runSummaryPath)) {
      throw new Error(`Run summary does not exist: ${runSummaryPath}`);
    }

    const runSummary = await fs.readJson(runSummaryPath);
    if (runSummary.status !== 'completed') {
      throw new Error(`Expected run status 'completed', got '${runSummary.status}'`);
    }

    // Extract run_id and request_id from the found evidence directory path
    const pathParts = foundEvidenceDir.split(/[\/\\]/);
    const runId = pathParts[pathParts.length - 1]; // Last part is the run ID
    const runsParentDir = pathParts[pathParts.length - 3]; // Parent of 'runs' folder is request ID

    // Create quality report
    const report = {
      run_id: runId,
      request_id: runsParentDir,
      timestamp: new Date().toISOString(),
      status: 'passed',
      assertions: {
        step_count: { expected: 1, actual: planEnvelope.payload.steps.length, passed: true },
        verb_type: { expected: 'noop', actual: planEnvelope.payload.steps[0].verb, passed: true },
        driver_type: { expected: 'noop', actual: planEnvelope.payload.steps[0].tool_binding.driver_kind, passed: true },
        no_http_steps: { expected: true, actual: !hasHttpSteps, passed: !hasHttpSteps },
        no_shell_steps: { expected: true, actual: !hasShellSteps, passed: !hasShellSteps },
        episodes_written: { expected: true, actual: await fs.pathExists(episodesDir), passed: await fs.pathExists(episodesDir) },
        run_summary_created: { expected: true, actual: await fs.pathExists(runSummaryPath), passed: await fs.pathExists(runSummaryPath) },
        run_status: { expected: 'completed', actual: runSummary.status, passed: runSummary.status === 'completed' },
        result_success: { expected: true, actual: result.success, passed: result.success }
      },
      result: result
    };

    // Create a quality-specific report directory
    const qualityRunId = `run_${Date.now()}_${uuidv4().split('-')[0]}`;
    const qualityRequestId = `req_${Date.now()}_${uuidv4().split('-')[0]}`;
    const qualityEvidenceDir = path.join('artifacts', 'quality', 'pos', qualityRequestId, 'runs', qualityRunId);
    await fs.ensureDir(qualityEvidenceDir);

    // Write report
    const reportPath = path.join(qualityEvidenceDir, 'report.json');
    await fs.writeJson(reportPath, report, { spaces: 2 });

    console.log('✓ Positive quality suite passed!');
    console.log(`Report written to: ${reportPath}`);

    return { success: true, report };

  } catch (error) {
    console.error('✗ Positive quality suite failed:', error.message);
    console.error('Stack:', error.stack);

    // Write failure report
    const runId = `run_${Date.now()}_${uuidv4().split('-')[0]}`;
    const requestId = `req_${Date.now()}_${uuidv4().split('-')[0]}`;
    const evidenceDir = path.join('artifacts', 'quality', 'pos', requestId, 'runs', runId);
    await fs.ensureDir(evidenceDir);

    const report = {
      run_id: runId,
      request_id: requestId,
      timestamp: new Date().toISOString(),
      status: 'failed',
      error: error.message,
      stack: error.stack
    };

    const reportPath = path.join(evidenceDir, 'report.json');
    await fs.writeJson(reportPath, report, { spaces: 2 });

    console.log(`Failure report written to: ${reportPath}`);

    return { success: false, error: error.message };
  }
}

// Run the quality suite
runPositiveQualitySuite()
  .then(result => {
    console.log('Final result:', result);
    process.exit(result.success ? 0 : 1);
  })
  .catch(error => {
    console.error('Quality suite execution error:', error);
    process.exit(1);
  });

