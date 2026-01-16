import { validateRequest } from './validate_tool_door_v0';
import { redactSensitiveData } from './redact_v0';
import { sha256Hex } from './hash_v0';
import { D1Store } from './d1_store_v0';

interface Env {
  TOOL_DOOR_DB: D1Database;
  TOOL_DOOR_TOKEN: string;
  TOOL_DOOR_POLICY_PATH: string;
}

interface ToolDoorRequest {
  policy_profile_id: string;
  env_ref?: string;
  request: Record<string, any>;
  context?: Record<string, any>;
  idempotency_key?: string;
}

interface ToolDoorReceipt {
  ok: boolean;
  outcome_code: string;
  evidence_ref: string;
  policy_trail_ref: string;
  result_core_hash: string;
}

interface PolicyProfile {
  allow_verbs: string[];
  allowed_hosts: string[];
  auth_required: boolean;
  throttle: {
    enabled: boolean;
    cooldown_ms: number;
    strict: boolean;
  };
  retry: {
    max_attempts: number;
    backoff_ms: number[];
  };
}

interface PolicyProfiles {
  [key: string]: PolicyProfile;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<any>): void;
}

export class ToolDoorWorker {
  async handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(Boolean);

    // Handle health check endpoint
    if (url.pathname === '/healthz' && request.method === 'GET') {
      return new Response(JSON.stringify({ ok: true, name: 'mova-tool-door-v0', version: 'v0' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Handle POST /tool/:verb endpoint
    if (pathParts.length === 2 && pathParts[0] === 'tool' && request.method === 'POST') {
      const verb = pathParts[1];
      return await this.handleToolVerb(request, env, ctx, verb);
    }

    // Return 404 for other routes
    return new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async handleToolVerb(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
    verb: string
  ): Promise<Response> {
    // A) Auth: Require Authorization: Bearer <TOOL_DOOR_TOKEN>
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      const receipt: ToolDoorReceipt = {
        ok: false,
        outcome_code: 'UNAUTHORIZED',
        evidence_ref: '',
        policy_trail_ref: '',
        result_core_hash: ''
      };
      return new Response(JSON.stringify(receipt), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    if (token !== env.TOOL_DOOR_TOKEN) {
      const receipt: ToolDoorReceipt = {
        ok: false,
        outcome_code: 'UNAUTHORIZED',
        evidence_ref: '',
        policy_trail_ref: '',
        result_core_hash: ''
      };
      return new Response(JSON.stringify(receipt), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // B) Parse JSON body
    let requestBody: any;
    try {
      requestBody = await request.json();
    } catch (error) {
      const receipt: ToolDoorReceipt = {
        ok: false,
        outcome_code: 'BAD_REQUEST',
        evidence_ref: '',
        policy_trail_ref: '',
        result_core_hash: ''
      };
      return new Response(JSON.stringify(receipt), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // C) Validate against schema
    const validation = validateRequest(requestBody);
    if (!validation.ok) {
      const receipt: ToolDoorReceipt = {
        ok: false,
        outcome_code: 'BAD_REQUEST',
        evidence_ref: '',
        policy_trail_ref: '',
        result_core_hash: ''
      };
      return new Response(JSON.stringify(receipt), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // D) Load policy profile
    // Note: In a real Cloudflare Worker, we'd load this from D1 or KV storage
    // For now, we'll simulate loading the policy profiles
    const policyProfiles: PolicyProfiles = {
      "dev_local_v0": {
        "allow_verbs": ["deliver", "external_call"],
        "allowed_hosts": ["127.0.0.1", "localhost"],
        "auth_required": true,
        "throttle": {
          "enabled": true,
          "cooldown_ms": 60000,
          "strict": false
        },
        "retry": {
          "max_attempts": 2,
          "backoff_ms": [200, 800]
        }
      },
      "prod_v0": {
        "allow_verbs": ["deliver", "external_call"],
        "allowed_hosts": [],
        "auth_required": true,
        "throttle": {
          "enabled": true,
          "cooldown_ms": 60000,
          "strict": true
        },
        "retry": {
          "max_attempts": 3,
          "backoff_ms": [300, 1200, 3000]
        }
      }
    };

    const policyProfileId = requestBody.policy_profile_id;
    const policyProfile = policyProfiles[policyProfileId];

    if (!policyProfile) {
      const receipt: ToolDoorReceipt = {
        ok: false,
        outcome_code: 'POLICY_DENIED',
        evidence_ref: '',
        policy_trail_ref: '',
        result_core_hash: ''
      };
      return new Response(JSON.stringify(receipt), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // E) Policy check: verb allowed
    if (!policyProfile.allow_verbs.includes(verb)) {
      // Write policy_trail row with decisions
      const policyTrailId = crypto.randomUUID();
      const decisions = { decision: 'DENIED', reason: `verb ${verb} not allowed`, policy_profile_id: policyProfileId };
      const store = new D1Store(env.TOOL_DOOR_DB);
      await store.insertPolicyTrail(policyTrailId, Date.now(), JSON.stringify(decisions));

      const receipt: ToolDoorReceipt = {
        ok: false,
        outcome_code: 'POLICY_DENIED',
        evidence_ref: '',
        policy_trail_ref: policyTrailId,
        result_core_hash: ''
      };
      return new Response(JSON.stringify(receipt), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Policy check: target host allowed
    let targetHost = '';
    if (verb === 'deliver' && requestBody.request.target_url) {
      try {
        const targetUrl = new URL(requestBody.request.target_url);
        targetHost = targetUrl.hostname;
      } catch (e) {
        // Invalid URL
        const policyTrailId = crypto.randomUUID();
        const decisions = { decision: 'DENIED', reason: 'invalid target URL', policy_profile_id: policyProfileId };
        const store = new D1Store(env.TOOL_DOOR_DB);
        await store.insertPolicyTrail(policyTrailId, Date.now(), JSON.stringify(decisions));

        const receipt: ToolDoorReceipt = {
          ok: false,
          outcome_code: 'POLICY_DENIED',
          evidence_ref: '',
          policy_trail_ref: policyTrailId,
          result_core_hash: ''
        };
        return new Response(JSON.stringify(receipt), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } else if (verb === 'external_call' && requestBody.request.target_url) {
      try {
        const targetUrl = new URL(requestBody.request.target_url);
        targetHost = targetUrl.hostname;
      } catch (e) {
        // Invalid URL
        const policyTrailId = crypto.randomUUID();
        const decisions = { decision: 'DENIED', reason: 'invalid target URL', policy_profile_id: policyProfileId };
        const store = new D1Store(env.TOOL_DOOR_DB);
        await store.insertPolicyTrail(policyTrailId, Date.now(), JSON.stringify(decisions));

        const receipt: ToolDoorReceipt = {
          ok: false,
          outcome_code: 'POLICY_DENIED',
          evidence_ref: '',
          policy_trail_ref: policyTrailId,
          result_core_hash: ''
        };
        return new Response(JSON.stringify(receipt), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Check if host is allowed
    if (policyProfile.allowed_hosts.length > 0 && !policyProfile.allowed_hosts.includes(targetHost)) {
      // Write policy_trail row with decisions
      const policyTrailId = crypto.randomUUID();
      const decisions = { decision: 'DENIED', reason: `host ${targetHost} not allowed`, policy_profile_id: policyProfileId };
      const store = new D1Store(env.TOOL_DOOR_DB);
      await store.insertPolicyTrail(policyTrailId, Date.now(), JSON.stringify(decisions));

      const receipt: ToolDoorReceipt = {
        ok: false,
        outcome_code: 'POLICY_DENIED',
        evidence_ref: '',
        policy_trail_ref: policyTrailId,
        result_core_hash: ''
      };
      return new Response(JSON.stringify(receipt), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Write policy_trail row with decisions
    const policyTrailId = crypto.randomUUID();
    const decisions = { decision: 'ALLOWED', reason: 'policy check passed', policy_profile_id: policyProfileId, verb, target_host: targetHost };
    const store = new D1Store(env.TOOL_DOOR_DB);
    await store.insertPolicyTrail(policyTrailId, Date.now(), JSON.stringify(decisions));

    // F) Idempotency check
    if (requestBody.idempotency_key) {
      const existingRecord = await store.getIdempotencyRecord(requestBody.idempotency_key);
      if (existingRecord) {
        // Return DUPLICATE_SUPPRESSED receipt (do not call outbound)
        const receipt: ToolDoorReceipt = {
          ok: true,
          outcome_code: 'DUPLICATE_SUPPRESSED',
          evidence_ref: existingRecord.evidence_id || '',
          policy_trail_ref: policyTrailId,
          result_core_hash: existingRecord.result_core_hash || ''
        };
        return new Response(JSON.stringify(receipt), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // G) Throttle check
    const throttleKey = `${verb}:${targetHost}`;
    if (policyProfile.throttle.enabled) {
      const throttleRecord = await store.getThrottleRecord(throttleKey);
      if (throttleRecord) {
        const now = Date.now();
        const timeSinceLastCall = now - throttleRecord.ts;
        
        if (timeSinceLastCall < policyProfile.throttle.cooldown_ms) {
          // Within cooldown period
          if (policyProfile.throttle.strict) {
            // strict=true => ok=false THROTTLED
            const receipt: ToolDoorReceipt = {
              ok: false,
              outcome_code: 'THROTTLED',
              evidence_ref: '',
              policy_trail_ref: policyTrailId,
              result_core_hash: ''
            };
            return new Response(JSON.stringify(receipt), {
              status: 429,
              headers: { 'Content-Type': 'application/json' },
            });
          } else {
            // strict=false => ok=true THROTTLED
            const receipt: ToolDoorReceipt = {
              ok: true,
              outcome_code: 'THROTTLED',
              evidence_ref: '',
              policy_trail_ref: policyTrailId,
              result_core_hash: ''
            };
            return new Response(JSON.stringify(receipt), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        }
      }
    }

    // H) Execute verb
    let result: any;
    let outcomeCode: string;
    let success = false;

    try {
      if (verb === 'deliver') {
        result = await this.executeDeliver(requestBody.request, requestBody.context, policyProfile.retry);
        outcomeCode = 'DELIVERED';
        success = true;
      } else if (verb === 'external_call') {
        result = await this.executeExternalCall(requestBody.request, policyProfile.retry);
        outcomeCode = 'EXTERNAL_CALL_OK';
        success = true;
      } else {
        // Unknown verb
        const receipt: ToolDoorReceipt = {
          ok: false,
          outcome_code: 'BAD_REQUEST',
          evidence_ref: '',
          policy_trail_ref: policyTrailId,
          result_core_hash: ''
        };
        return new Response(JSON.stringify(receipt), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } catch (error) {
      // Retry exhausted or other error
      outcomeCode = 'RETRY_EXHAUSTED';
      success = false;
      result = { error: error.message || 'Unknown error during execution' };
    }

    // I) Build receipt
    const ok = success && !(policyProfile.throttle.strict && outcomeCode === 'THROTTLED');
    
    // J) Evidence
    // Redact sensitive data in request and result
    const redactedRequest = redactSensitiveData(requestBody);
    const redactedResult = redactSensitiveData(result);
    
    // Create evidence record
    const evidenceId = crypto.randomUUID();
    const resultJson = JSON.stringify(redactedResult);
    const resultCoreHash = await sha256Hex(resultJson);
    
    await store.insertEvidence(
      evidenceId,
      Date.now(),
      verb,
      JSON.stringify(redactedRequest),
      resultJson,
      resultCoreHash
    );

    // Write idempotency record if idempotency_key present
    if (requestBody.idempotency_key) {
      await store.insertIdempotencyRecord(
        requestBody.idempotency_key,
        Date.now(),
        outcomeCode,
        evidenceId,
        resultCoreHash
      );
    }

    // Update throttle key timestamp on success only
    if (success) {
      await store.insertThrottleRecord(throttleKey, Date.now());
    }

    const receipt: ToolDoorReceipt = {
      ok,
      outcome_code: outcomeCode,
      evidence_ref: evidenceId,
      policy_trail_ref: policyTrailId,
      result_core_hash: resultCoreHash
    };

    return new Response(JSON.stringify(receipt), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async executeDeliver(
    request: Record<string, any>,
    context: Record<string, any>,
    retryConfig: { max_attempts: number; backoff_ms: number[] }
  ): Promise<any> {
    const { target_url, message, headers = {} } = request;
    
    if (!target_url) {
      throw new Error('Missing target_url in deliver request');
    }

    // Prepare message - if it's an object, stringify it as stable JSON
    let messageToSend = message;
    if (typeof message === 'object') {
      messageToSend = JSON.stringify(message);
    }

    const payload = {
      message: messageToSend,
      context: context || {}
    };

    return await this.performRetryableFetch(
      target_url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify(payload)
      },
      retryConfig
    );
  }

  private async executeExternalCall(
    request: Record<string, any>,
    retryConfig: { max_attempts: number; backoff_ms: number[] }
  ): Promise<any> {
    const { method, target_url, headers = {}, body } = request;
    
    if (!method || !target_url) {
      throw new Error('Missing method or target_url in external_call request');
    }

    return await this.performRetryableFetch(
      target_url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: typeof body === 'string' ? body : JSON.stringify(body)
      },
      retryConfig
    );
  }

  private async performRetryableFetch(
    url: string,
    options: RequestInit,
    retryConfig: { max_attempts: number; backoff_ms: number[] }
  ): Promise<any> {
    const maxAttempts = retryConfig.max_attempts;
    const backoffMs = retryConfig.backoff_ms;

    let lastError: any;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch(url, options);

        // If successful (2xx), return the response
        if (response.status >= 200 && response.status < 300) {
          const responseBody = await response.text();
          try {
            return JSON.parse(responseBody);
          } catch (e) {
            // If response is not JSON, return as text
            return { status: response.status, body: responseBody };
          }
        }

        // If we got a response but it wasn't successful, check if we should retry
        if (response.status >= 500 || response.status === 429) {
          if (attempt < maxAttempts - 1) {
            // Wait before retrying
            if (attempt < backoffMs.length) {
              await this.sleep(backoffMs[attempt]);
            } else {
              // If we run out of predefined backoff values, use the last one
              await this.sleep(backoffMs[backoffMs.length - 1]);
            }
            continue;
          }
        }

        // Return the response even if it's an error (but not a network error)
        const responseBody = await response.text();
        try {
          return { status: response.status, body: JSON.parse(responseBody) };
        } catch (e) {
          return { status: response.status, body: responseBody };
        }
      } catch (error) {
        // Network error - retry if possible
        lastError = error;
        if (attempt < maxAttempts - 1) {
          // Wait before retrying
          if (attempt < backoffMs.length) {
            await this.sleep(backoffMs[attempt]);
          } else {
            // If we run out of predefined backoff values, use the last one
            await this.sleep(backoffMs[backoffMs.length - 1]);
          }
        }
      }
    }

    // If we exhausted retries, throw the last error
    throw lastError || new Error(`Failed after ${maxAttempts} attempts`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const worker = new ToolDoorWorker();
    return await worker.handleRequest(request, env, ctx);
  },
};