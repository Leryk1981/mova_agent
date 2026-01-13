// @ts-nocheck
#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Interpreter } = require('../../build/src/interpreter/interpreter');
const { EpisodeWriter } = require('../../build/src/episodes/episode_writer');
const { validate } = require('../../build/src/ajv/ajv_loader');


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

    // Create a quality-specific evidence directory
    const qualityRunId = `run_${Date.now()}_${uuidv4().split('-')[0]}`;
    const qualityRequestId = `req_${Date.now()}_${uuidv4().split('-')[0]}`;
    const qualityEvidenceDir = path.join('artifacts', 'quality', 'pos', qualityRequestId, 'runs', qualityRunId);
    await fs.ensureDir(qualityEvidenceDir);

    // Initialize interpreter
    const interpreter = new Interpreter();

    // Run the plan with quality profile
    const result = await interpreter.runPlan({
      planEnvelope,
      toolPool,
      instructionProfile,
      tokenBudgetProfile: 'quality'  // Используем профиль качества по умолчанию
    });

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

    // 7. The interpreter should have created evidence in its own directory structure
    // The interpreter creates evidence in artifacts/mova_agent/<request_id>/runs/<run_id>/
    // But we need to check the actual run directory that was created
    const createdEvidenceDir = result.run_summary.evidence_dir || result.run_summary.evidenceDirectory; // Check what the interpreter actually returns

    // If we can't get the evidence directory from the result, we need to find it
    let evidenceDir = null;

    // Look for the most recently created evidence directory in mova_agent
    const evidenceBaseDir = 'artifacts/mova_agent';
    if (await fs.pathExists(evidenceBaseDir)) {
      const reqDirs = await fs.readdir(evidenceBaseDir);
      // Sort by modification time to find the most recent
      const reqStats = await Promise.all(
        reqDirs.map(async (dir) => {
          const stat = await fs.stat(path.join(evidenceBaseDir, dir));
          return { dir, mtime: stat.mtime };
        })
      );
      reqStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      for (const reqStat of reqStats) {
        const reqPath = path.join(evidenceBaseDir, reqStat.dir);
        if ((await fs.stat(reqPath)).isDirectory()) {
          const runsPath = path.join(reqPath, 'runs');
          if (await fs.pathExists(runsPath)) {
            const runDirs = await fs.readdir(runsPath);
            // Sort run dirs by modification time too
            const runStats = await Promise.all(
              runDirs.map(async (dir) => {
                const stat = await fs.stat(path.join(runsPath, dir));
                return { dir, mtime: stat.mtime };
              })
            );
            runStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

            if (runStats.length > 0) {
              evidenceDir = path.join(runsPath, runStats[0].dir);
              break;
            }
          }
        }
      }
    }

    if (!evidenceDir) {
      throw new Error('Evidence directory was not created by interpreter');
    }

    console.log(`Found evidence directory: ${evidenceDir}`);

    // 8. Check that episodes directory exists
    const episodesDir = path.join(evidenceDir, 'episodes');
    if (!await fs.pathExists(episodesDir)) {
      throw new Error(`Episodes directory does not exist: ${episodesDir}`);
    }

    // 9. Check that episodes index.jsonl exists
    const episodesIndexPath = path.join(episodesDir, 'index.jsonl');
    if (!await fs.pathExists(episodesIndexPath)) {
      throw new Error(`Episodes index.jsonl does not exist: ${episodesIndexPath}`);
    }

    // 10. Check that run summary was created
    const runSummaryPath = path.join(evidenceDir, 'run_summary.json');
    if (!await fs.pathExists(runSummaryPath)) {
      throw new Error(`Run summary does not exist: ${runSummaryPath}`);
    }

    const runSummary = await fs.readJson(runSummaryPath);
    if (runSummary.status !== 'completed') {
      throw new Error(`Expected run status 'completed', got '${runSummary.status}'`);
    }

    // Extract run_id and request_id from the found evidence directory path
    const pathParts = evidenceDir.split(/[\/\\]/);
    const runId = pathParts[pathParts.length - 1]; // Last part is the run ID
    const runsParentDir = pathParts[pathParts.length - 3]; // Parent of 'runs' folder is request ID

    // Create checked_run object with paths
    const checkedRun = {
      request_id: runsParentDir,
      run_id: runId,
      evidence_dir: evidenceDir,
      run_summary_path: runSummaryPath,
      episodes_index_path: episodesIndexPath
    };

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
        episodes_index_exists: { expected: true, actual: await fs.pathExists(episodesIndexPath), passed: await fs.pathExists(episodesIndexPath) },
        run_summary_created: { expected: true, actual: await fs.pathExists(runSummaryPath), passed: await fs.pathExists(runSummaryPath) },
        run_status: { expected: 'completed', actual: runSummary.status, passed: runSummary.status === 'completed' },
        result_success: { expected: true, actual: result.success, passed: result.success }
      },
      checked_run: checkedRun,
      refs: [
        { type: 'quality_report', path: path.join(qualityEvidenceDir, 'report.json'), note: 'Self-reference to this quality report' },
        { type: 'run_summary', path: runSummaryPath, bytes: fs.statSync(runSummaryPath).size },
        { type: 'episodes_index', path: episodesIndexPath, bytes: fs.statSync(episodesIndexPath).size },
        { type: 'token_budget_resolved', path: path.join(evidenceDir, 'token_budget.resolved.json'), bytes: fs.existsSync(path.join(evidenceDir, 'token_budget.resolved.json')) ? fs.statSync(path.join(evidenceDir, 'token_budget.resolved.json')).size : 0 },
        { type: 'token_usage', path: path.join(evidenceDir, 'token_usage.json'), bytes: fs.existsSync(path.join(evidenceDir, 'token_usage.json')) ? fs.statSync(path.join(evidenceDir, 'token_usage.json')).size : 0 },
        { type: 'proof_log', path: path.join('artifacts', 'quality', '_proof_latest.log'), bytes: fs.existsSync(path.join('artifacts', 'quality', '_proof_latest.log')) ? fs.statSync(path.join('artifacts', 'quality', '_proof_latest.log')).size : 0 }
      ],
      result: result
    };

    // Write report to the quality evidence directory
    const reportPath = path.join(qualityEvidenceDir, 'report.json');
    await fs.writeJson(reportPath, report, { spaces: 2 });

    // Validate all episodes in the index.jsonl file to guard against regressions
    const episodesIndexContent = await fs.readFile(episodesIndexPath, 'utf8');
    const episodeLines = episodesIndexContent.trim().split('\n').filter(line => line.trim());

    let validationErrors = [];
    for (const line of episodeLines) {
      if (line.trim()) {
        try {
          const episode = JSON.parse(line);
          // Determine schema based on episode type
          let schemaId = 'ds.mova_episode_core_v1';
          if (episode.episode_type && episode.episode_type.startsWith('security_event/')) {
            schemaId = 'ds.security_event_episode_core_v1';
          }

          const validation = await validate(schemaId, episode);
          if (!validation.ok) {
            validationErrors.push({
              episode_id: episode.episode_id,
              errors: validation.errors
            });
          }
        } catch (parseError) {
          validationErrors.push({ error: `Failed to parse episode line: ${line}`, parseError: parseError.message });
        }
      }
    }

    if (validationErrors.length > 0) {
      // Save detailed errors to file instead of printing to console
      const errorReportPath = path.join(qualityEvidenceDir, 'validation_error_report.json');
      await fs.writeJson(errorReportPath, {
        timestamp: new Date().toISOString(),
        error_count: validationErrors.length,
        errors: validationErrors
      }, { spaces: 2 });

      console.error(`quality_pos failed: episode validation failed (see ref ${errorReportPath})`);
      throw new Error(`Episode validation failed, see ${errorReportPath}`);
    }

    return { success: true, report };

  } catch (error) {
    console.error('✗ Positive quality suite failed:', error.message);

    // Write failure report with robust structure
    const runId = `run_${Date.now()}_${uuidv4().split('-')[0]}`;
    const requestId = `req_${Date.now()}_${uuidv4().split('-')[0]}`;
    const evidenceDir = path.join('artifacts', 'quality', 'pos', requestId, 'runs', runId);
    await fs.ensureDir(evidenceDir);

    // Look for the actual interpreter evidence directory if available
    let interpreterEvidenceDir = null;
    const evidenceBaseDir = 'artifacts/mova_agent';
    if (await fs.pathExists(evidenceBaseDir)) {
      const reqDirs = await fs.readdir(evidenceBaseDir);
      // Sort by modification time to find the most recent
      const reqStats = await Promise.all(
        reqDirs.map(async (dir) => {
          const stat = await fs.stat(path.join(evidenceBaseDir, dir));
          return { dir, mtime: stat.mtime };
        })
      );
      reqStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      for (const reqStat of reqStats) {
        const reqPath = path.join(evidenceBaseDir, reqStat.dir);
        if ((await fs.stat(reqPath)).isDirectory()) {
          const runsPath = path.join(reqPath, 'runs');
          if (await fs.pathExists(runsPath)) {
            const runDirs = await fs.readdir(runsPath);
            // Sort run dirs by modification time too
            const runStats = await Promise.all(
              runDirs.map(async (dir) => {
                const stat = await fs.stat(path.join(runsPath, dir));
                return { dir, mtime: stat.mtime };
              })
            );
            runStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

            if (runStats.length > 0) {
              interpreterEvidenceDir = path.join(runsPath, runStats[0].dir);
              break;
            }
          }
        }
      }
    }

    // Extract run_id and request_id from the found evidence directory path if available
    let checkedRun = null;
    if (interpreterEvidenceDir) {
      const pathParts = interpreterEvidenceDir.split(/[\/\\]/);
      const runIdFromPath = pathParts[pathParts.length - 1]; // Last part is the run ID
      const runsParentDir = pathParts[pathParts.length - 3]; // Parent of 'runs' folder is request ID

      const runSummaryPath = path.join(interpreterEvidenceDir, 'run_summary.json');
      const episodesIndexPath = path.join(interpreterEvidenceDir, 'episodes', 'index.jsonl');

      checkedRun = {
        request_id: runsParentDir,
        run_id: runIdFromPath,
        evidence_dir: interpreterEvidenceDir,
        run_summary_path: runSummaryPath,
        episodes_index_path: episodesIndexPath
      };
    } else {
      // Create a minimal checked_run structure even if interpreter evidence wasn't created
      checkedRun = {
        request_id: requestId,
        run_id: runId,
        evidence_dir: evidenceDir,
        run_summary_path: null,
        episodes_index_path: null
      };
    }

    const report = {
      run_id: runId,
      request_id: requestId,
      timestamp: new Date().toISOString(),
      status: 'failed',
      error: error.message,
      stack: error.stack,
      checked_run: checkedRun,
      refs: [
        { type: 'quality_report', path: path.join(evidenceDir, 'report.json'), note: 'Self-reference to this quality report' },
        { type: 'proof_log', path: path.join('artifacts', 'quality', '_proof_latest.log'), bytes: fs.existsSync(path.join('artifacts', 'quality', '_proof_latest.log')) ? fs.statSync(path.join('artifacts', 'quality', '_proof_latest.log')).size : 0 }
      ]
    };

    // Add token budget and usage refs if the interpreter evidence directory exists
    if (interpreterEvidenceDir) {
      const tokenBudgetPath = path.join(interpreterEvidenceDir, 'token_budget.resolved.json');
      const tokenUsagePath = path.join(interpreterEvidenceDir, 'token_usage.json');

      report.refs.push(
        { type: 'token_budget_resolved', path: tokenBudgetPath, bytes: fs.existsSync(tokenBudgetPath) ? fs.statSync(tokenBudgetPath).size : 0 },
        { type: 'token_usage', path: tokenUsagePath, bytes: fs.existsSync(tokenUsagePath) ? fs.statSync(tokenUsagePath).size : 0 }
      );

      // Add run summary and episodes index if they exist
      if (fs.existsSync(checkedRun.run_summary_path)) {
        report.refs.push({ type: 'run_summary', path: checkedRun.run_summary_path, bytes: fs.statSync(checkedRun.run_summary_path).size });
      }
      if (fs.existsSync(checkedRun.episodes_index_path)) {
        report.refs.push({ type: 'episodes_index', path: checkedRun.episodes_index_path, bytes: fs.statSync(checkedRun.episodes_index_path).size });
      }
    }

    const reportPath = path.join(evidenceDir, 'report.json');
    await fs.writeJson(reportPath, report, { spaces: 2 });

    console.log(`Failure report written to: ${reportPath}`);

    return { success: false, error: error.message };
  }
}

// Run the quality suite
runPositiveQualitySuite()
  .then(result => {
    process.exit(result.success ? 0 : 1);
  })
  .catch(error => {
    console.error('Quality suite execution error:', error);
    process.exit(1);
  });

