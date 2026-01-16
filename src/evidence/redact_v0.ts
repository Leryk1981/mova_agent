import { URL } from 'url';

const SENSITIVE_KEYS = ['token', 'secret', 'key', 'auth', 'password', 'authorization'];

function isSensitiveKey(key: string): boolean {
  const lower = (key || '').toLowerCase();
  return SENSITIVE_KEYS.some((m) => lower.includes(m));
}

function looksSensitiveString(value: string): boolean {
  const lower = (value || '').toLowerCase();
  return SENSITIVE_KEYS.some((m) => lower.includes(m));
}

function mask(): string {
  return '[REDACTED]';
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = '?[REDACTED]';
    url.hash = '';
    return url.toString();
  } catch {
    return mask();
  }
}

function redactValue(value: any, keyHint: string | undefined, seen: WeakSet<object>): any {
  if (value === null || value === undefined) return value;

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[CYCLE]';
    }
    seen.add(value);
  }

  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, undefined, seen));
  }

  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactValue(v, k, seen);
    }
    return out;
  }

  if (typeof value === 'string') {
    const lowerVal = value.toLowerCase();
    if (isSensitiveKey(keyHint || '') || looksSensitiveString(value)) {
      return mask();
    }
    if (lowerVal.startsWith('http://') || lowerVal.startsWith('https://')) {
      return redactUrl(value);
    }
    return value;
  }

  return value;
}

export function redactObject(input: any): any {
  const seen = new WeakSet<object>();
  return redactValue(input, undefined, seen);
}
