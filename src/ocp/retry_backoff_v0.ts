export type RetryAttemptStatus = 'DELIVERED' | 'RETRYABLE_FAIL' | 'NON_RETRYABLE_FAIL';

export interface RetryAttemptLog {
  attempt: number;
  status: RetryAttemptStatus;
  http_status?: number;
  error_code?: string;
  planned_backoff_ms: number;
}

export interface RetryPolicyConfig {
  retry_enabled?: boolean;
  max_attempts?: number;
  retry_on_status?: number[];
  base_backoff_ms?: number;
  max_backoff_ms?: number;
}

export interface RetryOutcome<T> {
  result?: T;
  attempts: RetryAttemptLog[];
  outcome_code: 'DELIVERED' | 'RETRY_EXHAUSTED' | 'NON_RETRYABLE_HTTP_STATUS' | 'NETWORK_ERROR';
  last_error?: any;
}

function computeBackoffMs(policy: RetryPolicyConfig, attempt: number): number {
  const base = policy.base_backoff_ms ?? 0;
  const max = policy.max_backoff_ms ?? 0;
  if (base <= 0) {
    return 0;
  }
  const planned = base * Math.pow(2, attempt - 1);
  return max > 0 ? Math.min(max, planned) : planned;
}

function shouldRetryStatus(policy: RetryPolicyConfig, status?: number): boolean {
  if (typeof status !== 'number') return false;
  const retryStatuses = policy.retry_on_status || [];
  return retryStatuses.includes(status);
}

function isNetworkError(error: any): { code?: string } | null {
  if (!error) return null;
  const code = (error as any).code || (error as any).name;
  if (!code) return null;
  return { code: String(code) };
}

async function delay(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runWithRetry<T extends { status?: number }>(
  operation: () => Promise<T>,
  policy: RetryPolicyConfig
): Promise<RetryOutcome<T>> {
  const maxAttempts = Math.max(1, policy.max_attempts ?? 1);
  const attempts: RetryAttemptLog[] = [];
  let lastError: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await operation();
      const httpStatus = result.status;
      const delivered = typeof httpStatus === 'number' && httpStatus >= 200 && httpStatus < 300;

      if (delivered) {
        attempts.push({
          attempt,
          status: 'DELIVERED',
          http_status: httpStatus,
          planned_backoff_ms: 0,
        });

        return { result, attempts, outcome_code: 'DELIVERED' };
      }

      const retryable = shouldRetryStatus(policy, httpStatus);
      const backoff = attempt < maxAttempts ? computeBackoffMs(policy, attempt) : 0;

      attempts.push({
        attempt,
        status: retryable ? 'RETRYABLE_FAIL' : 'NON_RETRYABLE_FAIL',
        http_status: httpStatus,
        planned_backoff_ms: backoff,
      });

      if (!retryable || attempt === maxAttempts) {
        return {
          result,
          attempts,
          outcome_code: retryable ? 'RETRY_EXHAUSTED' : 'NON_RETRYABLE_HTTP_STATUS',
        };
      }

      await delay(backoff);
    } catch (error: any) {
      lastError = error;
      const network = isNetworkError(error);
      const backoff = attempt < maxAttempts ? computeBackoffMs(policy, attempt) : 0;

      attempts.push({
        attempt,
        status: network ? 'RETRYABLE_FAIL' : 'NON_RETRYABLE_FAIL',
        error_code: network?.code,
        planned_backoff_ms: backoff,
      });

      if (!network || attempt === maxAttempts) {
        return {
          attempts,
          last_error: error,
          outcome_code: 'NETWORK_ERROR',
        };
      }

      await delay(backoff);
    }
  }

  return { attempts, outcome_code: 'RETRY_EXHAUSTED', last_error: lastError };
}
