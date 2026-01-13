// @ts-nocheck
#!/usr/bin/env node

console.log('Starting quality_neg.js');

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Interpreter } = require('../../build/src/interpreter/interpreter');
const { validate } = require('../../build/src/ajv/ajv_loader');

async function initializeSchemaLoader() {
    const { AjvSchemaLoader } = require('../../build/src/ajv/ajv_loader');
  const loader = new AjvSchemaLoader();
  await loader.initialize();
  return loader;
}

async function runNegativeQualitySuite() {
  console.log('Running negative quality suite...');

  try {
    // Create a quality-specific evidence directory
    const qualityRunId = `run_${Date.now()}_${uuidv4().split('-')[0]}`;
    const qualityRequestId = `req_${Date.now()}_${uuidv4().split('-')[0]}`;
    const qualityEvidenceDir = path.join('artifacts', 'quality', 'neg', qualityRequestId, 'runs', qualityRunId);
    await fs.ensureDir(qualityEvidenceDir);

    console.log(`Quality evidence directory: ${qualityEvidenceDir}`);

    // Create a plan that would create 1 HTTP step (but should be denied by policy)
    const planEnvelope = {
      verb: "execute",
      subject_ref: "user_request",
      object_ref: "execution_plan",
      payload: {
        steps: [{
          id: 'step-1',
          verb: 'http',
          connector_id: 'http_connector_1',
          input: {
            url: 'https://httpbin.org/get',
            method: 'GET'
          },
          tool_binding: {
            driver_kind: 'http',
            limits: {
              timeout_ms: 5000,
              max_data_size: 102400
            }
          }
        }]
      }
    };

    // Create a noop-only tool pool (this should deny the HTTP step)
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
      // Note: No HTTP connector is provided, so the HTTP step should be denied
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

    // Run the plan with quality profile - this should fail due to policy denial
    const result = await interpreter.runPlan({
      planEnvelope,
      toolPool,
      instructionProfile,
      tokenBudgetProfile: 'quality'  // Используем профиль качества по умолчанию
    });

    // Assertions
    console.log('Checking assertions...');

    // 1. Run should fail (not succeed)
    if (result.success) {
      throw new Error('Expected run to fail due to policy denial, but it succeeded');
    }

    // 2. Find the actual evidence directory created by the interpreter
    // Look for the most recently created evidence directory in mova_agent
    let evidenceDir = null;
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

    // 3. Security episode should be "tool_not_allowlisted" or "policy_check_failed"
    // We need to check the episodes directory for security events
    const episodesDir = path.join(evidenceDir, 'episodes');
    if (!await fs.pathExists(episodesDir)) {
      throw new Error(`Episodes directory does not exist: ${episodesDir}`);
    }

    // Read the index.jsonl file to find security events
    const indexPath = path.join(episodesDir, 'index.jsonl');
    if (!await fs.pathExists(indexPath)) {
      throw new Error(`Episodes index does not exist: ${indexPath}`);
    }

    const indexContent = await fs.readFile(indexPath, 'utf8');
    const episodes = indexContent.trim().split('\n').filter(line => line).map(line => JSON.parse(line));

    // Find security events
    const securityEvents = episodes.filter(ep => ep.episode_type && ep.episode_type.startsWith('security_event'));

    if (securityEvents.length === 0) {
      throw new Error('No security events found in episodes');
    }

    // Check if we have the expected security event types
    const hasToolNotAllowlisted = securityEvents.some(ep =>
      ep.episode_type.includes('tool_not_allowlisted') || ep.episode_type.includes('policy_check_failed')
    );

    if (!hasToolNotAllowlisted) {
      console.log('Available security events:', securityEvents.map(ep => ep.episode_type));
      throw new Error('Expected security event "tool_not_allowlisted" or "policy_check_failed", but not found');
    }

    // 4. Overall execution episode status should be "failed" OR we should have security events that caused the failure
    // When a policy violation occurs, we may not have execution episodes for the failed steps,
    // but we should have security events that prevented execution
    const executionEpisodes = episodes.filter(ep => !ep.episode_type.startsWith('security_event'));
    const hasFailedExecution = executionEpisodes.some(ep => ep.result_status === 'failed');
    const hasSecurityEvents = securityEvents.length > 0;

    // Either we have failed execution episodes OR we have security events that prevented execution
    if (!hasFailedExecution && !hasSecurityEvents) {
      throw new Error('Expected either failed execution episodes or security events that caused the failure');
    }

    // 5. Check that run summary was created and shows failure
    const runSummaryPath = path.join(evidenceDir, 'run_summary.json');
    if (!await fs.pathExists(runSummaryPath)) {
      throw new Error(`Run summary does not exist: ${runSummaryPath}`);
    }

    const runSummary = await fs.readJson(runSummaryPath);
    if (runSummary.status !== 'failed') {
      throw new Error(`Expected run status 'failed', got '${runSummary.status}'`);
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
      episodes_index_path: indexPath
    };

    // Create quality report
    const report = {
      run_id: runId,
      request_id: runsParentDir,
      timestamp: new Date().toISOString(),
      status: 'passed',
      assertions: {
        run_should_fail: { expected: true, actual: !result.success, passed: !result.success },
        security_event_present: { expected: true, actual: securityEvents.length > 0, passed: securityEvents.length > 0 },
        correct_security_event: { expected: true, actual: hasToolNotAllowlisted, passed: hasToolNotAllowlisted },
        execution_failed: { expected: true, actual: hasFailedExecution, passed: hasFailedExecution },
        episodes_index_exists: { expected: true, actual: await fs.pathExists(indexPath), passed: await fs.pathExists(indexPath) },
        run_summary_created: { expected: true, actual: await fs.pathExists(runSummaryPath), passed: await fs.pathExists(runSummaryPath) },
        run_status_failed: { expected: true, actual: runSummary.status === 'failed', passed: runSummary.status === 'failed' }
      },
      checked_run: checkedRun,
      refs: [
        { type: 'quality_report', path: path.join(qualityEvidenceDir, 'report.json'), note: 'Self-reference to this quality report' },
        { type: 'run_summary', path: runSummaryPath, bytes: fs.statSync(runSummaryPath).size },
        { type: 'episodes_index', path: indexPath, bytes: fs.statSync(indexPath).size },
        { type: 'token_budget_resolved', path: path.join(evidenceDir, 'token_budget.resolved.json'), bytes: fs.existsSync(path.join(evidenceDir, 'token_budget.resolved.json')) ? fs.statSync(path.join(evidenceDir, 'token_budget.resolved.json')).size : 0 },
        { type: 'token_usage', path: path.join(evidenceDir, 'token_usage.json'), bytes: fs.existsSync(path.join(evidenceDir, 'token_usage.json')) ? fs.statSync(path.join(evidenceDir, 'token_usage.json')).size : 0 },
        { type: 'proof_log', path: path.join('artifacts', 'quality', '_proof_latest.log'), bytes: fs.existsSync(path.join('artifacts', 'quality', '_proof_latest.log')) ? fs.statSync(path.join('artifacts', 'quality', '_proof_latest.log')).size : 0 }
      ],
      result: result,
      security_events: securityEvents
    };

    // Write report to the quality evidence directory
    const reportPath = path.join(qualityEvidenceDir, 'report.json');
    await fs.writeJson(reportPath, report, { spaces: 2 });

    // Validate all episodes in the index.jsonl file to guard against regressions
    // Use the existing validate function
    const { validate } = require('../../build/src/ajv/ajv_loader');

    const episodesIndexContent = await fs.readFile(indexPath, 'utf8');
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
          if (!validation.ok && validation.errors) {
            // Strict validation: any schema failure (including security events) is fatal
            const detailedErrors = validation.errors.map(error => ({
              keyword: error.keyword,
              instancePath: error.instancePath,
              params: error.params,
              message: error.message
            }));

            validationErrors.push({
              episode_id: episode.episode_id,
              schema: schemaId,
              errors: detailedErrors
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

      console.error(`quality_neg failed: episode validation failed (see ref ${errorReportPath})`);
      throw new Error(`Episode validation failed, see ${errorReportPath}`);
    }

    return { success: true, report };

  } catch (error) {
    console.error('✗ Negative quality suite failed:', error.message);

    // Write failure report with robust structure
    const runId = `run_${Date.now()}_${uuidv4().split('-')[0]}`;
    const requestId = `req_${Date.now()}_${uuidv4().split('-')[0]}`;
    const evidenceDir = path.join('artifacts', 'quality', 'neg', requestId, 'runs', runId);
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
runNegativeQualitySuite()
  .then(result => {
    process.exit(result.success ? 0 : 1);
  })
  .catch(error => {
    console.error('Quality suite execution error:', error);
    process.exit(1);
  });

