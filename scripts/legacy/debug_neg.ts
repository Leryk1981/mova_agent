// @ts-nocheck
#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Interpreter } = require('./build/src/interpreter/interpreter');
const { validate } = require('./build/src/ajv/ajv_loader');

async function initializeSchemaLoader() {
  const { AjvSchemaLoader } = require('./build/src/ajv/ajv_loader');
  const loader = new AjvSchemaLoader();
  await loader.initialize();
  return loader;
}

async function runNegativeQualitySuite() {
  console.log('Running negative quality suite...');

  try {
    // Initialize schema loader first
    await initializeSchemaLoader();
    
    // Create a plan that should trigger a security event (using a disallowed connector)
    const planEnvelope = {
      verb: "execute",
      subject_ref: "user_request",
      object_ref: "execution_plan",
      payload: {
        steps: [{
          id: "step-1",
          verb: "get",
          connector_id: "http_connector_1", // This connector is not in the allowlist
          input: {
            url: "http://example.com/api/data",
            method: "GET"
          },
          expected_output_schema_ref: "env.http_response_v1"
        }]
      }
    };

    // Create a restrictive tool pool that doesn't include the http connector
    const restrictiveToolPool = {
      tools: [
        // Only include noop connector to force a security event
        {
          id: "noop_tool",
          connector: { verb: "noop" },
          binding: {
            driver_kind: "noop",
            limits: {
              timeout_ms: 5000,
              max_retries: 1
            },
            destination_allowlist: [] // Empty allowlist to block all destinations
          }
        }
      ]
    };

    // Create a basic instruction profile
    const instructionProfile = {
      caps: {
        max_timeout_ms: 10000,
        max_data_size: 1024 * 1024, // 1MB
        max_steps: 10
      },
      redaction_rules: ["secret", "password", "token"]
    };

    // Create interpreter instance
    const interpreter = new Interpreter();
    
    // Wait for interpreter to be ready
    await interpreter.ready();

    // Execute the plan - this should fail due to security policy
    const result = await interpreter.runPlan({
      planEnvelope,
      toolPool: restrictiveToolPool,
      instructionProfile
    });

    if (result.success) {
      throw new Error("Expected plan to fail due to security policy, but it succeeded");
    }

    console.log("✓ Plan correctly failed due to security policy");

    // Find the evidence directory for this run
    const evidenceDirs = await fs.readdir('artifacts/mova_agent');
    const latestRequestDir = evidenceDirs
      .filter(dir => dir.startsWith('req_'))
      .sort()
      .pop();

    if (!latestRequestDir) {
      throw new Error("No evidence directory found");
    }

    const requestDirPath = path.join('artifacts', 'mova_agent', latestRequestDir);
    const runDirs = await fs.readdir(requestDirPath);
    const latestRunDir = runDirs
      .filter(dir => dir.startsWith('run_'))
      .sort()
      .pop();

    if (!latestRunDir) {
      throw new Error("No run directory found");
    }

    const evidenceDir = path.join(requestDirPath, 'runs', latestRunDir);
    const indexPath = path.join(evidenceDir, 'episodes', 'index.jsonl');
    const runSummaryPath = path.join(evidenceDir, 'run_summary.json');

    // Verify the episodes file exists
    if (!(await fs.pathExists(indexPath))) {
      throw new Error(`Episodes index file does not exist: ${indexPath}`);
    }

    // Verify run summary exists
    if (!(await fs.pathExists(runSummaryPath))) {
      throw new Error(`Run summary file does not exist: ${runSummaryPath}`);
    }

    // Read and parse the episodes
    const episodesContent = await fs.readFile(indexPath, 'utf8');
    const episodeLines = episodesContent.trim().split('\n').filter(line => line.trim());
    const episodes = episodeLines.map(line => JSON.parse(line));

    // Look for security events
    const securityEvents = episodes.filter(episode => 
      episode.episode_type && episode.episode_type.startsWith('security_event/')
    );

    const executionEpisodes = episodes.filter(episode => 
      episode.episode_type && (
        episode.episode_type === 'execution_step' || 
        episode.episode_type === 'execution_run_summary'
      )
    );

    if (securityEvents.length === 0) {
      throw new Error("No security events found in episodes");
    }

    console.log(`✓ Found ${securityEvents.length} security events`);

    // Check that we have the expected security event
    const toolNotAllowlistedEvents = securityEvents.filter(event => 
      event.security_event_type === 'tool_not_allowlisted'
    );
    
    if (toolNotAllowlistedEvents.length === 0) {
      throw new Error("No tool_not_allowlisted security events found");
    }

    console.log("✓ Found expected tool_not_allowlisted security event");

    // Check for execution episodes
    const hasFailedExecution = executionEpisodes.some(episode => 
      episode.result_status === 'failed'
    );

    if (!hasFailedExecution) {
      throw new Error("No failed execution episodes found");
    }

    console.log("✓ Found failed execution episodes");

    // Validate all episodes in the index.jsonl file to guard against regressions
    const episodesIndexContent = await fs.readFile(indexPath, 'utf8');
    const episodeLinesCheck = episodesIndexContent.trim().split('\n').filter(line => line.trim());
    
    let validationErrors = [];
    for (const line of episodeLinesCheck) {
      if (line.trim()) {
        try {
          const episode = JSON.parse(line);
          // Determine schema based on episode type
          let schemaId = 'ds.mova_episode_core_v1';
          if (episode.episode_type && episode.episode_type.startsWith('security_event/')) {
            schemaId = 'ds.security_event_episode_core_v1';
          }
          
          console.log(`Validating episode with schema: ${schemaId}`);
          const validation = await validate(schemaId, episode);
          console.log(`Validation result for ${episode.episode_id}: ${validation.ok}`);
          
          if (!validation.ok) {
            validationErrors.push({
              episode_id: episode.episode_id,
              errors: validation.errors
            });
            
            // Check for additional properties specifically
            if (validation.errors) {
              for (const error of validation.errors) {
                if (error.keyword === 'additionalProperties') {
                  console.warn(`EPISODE_VALIDATION_ERROR: ${error.instancePath} has additional property: ${error.params?.additionalProperty}`);
                }
              }
            }
          }
        } catch (parseError) {
          validationErrors.push({ error: `Failed to parse episode line: ${line}`, parseError: parseError.message });
        }
      }
    }
    
    if (validationErrors.length > 0) {
      console.error(`✗ Episode validation failed for ${validationErrors.length} episodes`);
      console.error(JSON.stringify(validationErrors, null, 2));
      throw new Error(`Episode validation failed: ${JSON.stringify(validationErrors, null, 2)}`);
    }

    console.log("✓ All episodes passed validation");

    // Create quality report
    const qualityRequestId = `req_${Date.now()}_${uuidv4().split('-')[0]}`;
    const qualityEvidenceDir = path.join('artifacts', 'quality', 'neg', qualityRequestId, 'runs', `run_${Date.now()}_${uuidv4().split('-')[0]}`);
    await fs.ensureDir(qualityEvidenceDir);

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
        correct_security_event: { expected: true, actual: toolNotAllowlistedEvents.length > 0, passed: toolNotAllowlistedEvents.length > 0 },
        execution_failed: { expected: true, actual: hasFailedExecution, passed: hasFailedExecution },
        episodes_index_exists: { expected: true, actual: await fs.pathExists(indexPath), passed: await fs.pathExists(indexPath) },
        run_summary_created: { expected: true, actual: await fs.pathExists(runSummaryPath), passed: await fs.pathExists(runSummaryPath) },
        run_status_failed: { expected: true, actual: result.run_summary?.status === 'failed', passed: result.run_summary?.status === 'failed' }
      },
      checked_run: checkedRun,
      result: result,
      security_events: securityEvents
    };

    // Write report to the quality evidence directory
    const reportPath = path.join(qualityEvidenceDir, 'report.json');
    await fs.writeJson(reportPath, report, { spaces: 2 });

    console.log('✓ Negative quality suite passed!');
    console.log(`Checked run: ${evidenceDir}`);
    console.log(`Report written to: ${reportPath}`);

    return { success: true, report };
  } catch (error) {
    console.error('✗ Negative quality suite failed:', error.message);
    console.error(error.stack);
    throw error;
  }
}

// Run the test
runNegativeQualitySuite()
  .then(() => console.log('Test completed successfully'))
  .catch(err => {
    console.error('Test failed:', err.message);
    process.exit(1);
  });

