import { Driver, DriverContext } from './index';

type RequestInitLike = Parameters<typeof fetch>[1];

type HttpInput = {
  url?: string;
  endpoint?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: any;
};

function isUrlAllowed(url: string, allowlist?: string[]): boolean {
  if (!allowlist || allowlist.length === 0) return true;

  return allowlist.some((allowed) => {
    try {
      const inputUrl = new URL(url);
      const allowedUrl = new URL(allowed);
      return (
        inputUrl.hostname === allowedUrl.hostname &&
        inputUrl.protocol === allowedUrl.protocol &&
        (inputUrl.port === allowedUrl.port || allowedUrl.port === '')
      );
    } catch {
      return false;
    }
  });
}

export function httpDriverFactory(): Driver {
  return {
    async execute(input: HttpInput, context?: DriverContext): Promise<any> {
      const url = input.url || input.endpoint;
      if (!url) {
        throw new Error('HTTP driver requires url or endpoint');
      }

      if (!isUrlAllowed(url, context?.allowlist)) {
        throw new Error(`Destination not allowlisted: ${url}`);
      }

      const method = (input.method || 'GET').toUpperCase();
      const controller = new AbortController();
      const timeout = context?.limits?.timeout_ms ?? 5000;
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const fetchOptions: RequestInitLike = {
          method,
          headers: input.headers,
          signal: controller.signal,
        };

        if (method !== 'GET' && method !== 'HEAD' && input.body !== undefined) {
          fetchOptions.body =
            typeof input.body === 'string' ? input.body : JSON.stringify(input.body);
          fetchOptions.headers = {
            'Content-Type': 'application/json',
            ...(input.headers || {}),
          };
        }

        const response = await fetch(url, fetchOptions);
        const text = await response.text();

        let parsed: any = text;
        try {
          parsed = JSON.parse(text);
        } catch {
          // leave as text if not JSON
        }

        return {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: parsed,
          url,
        };
      } catch (error: any) {
        if (error.name === 'AbortError') {
          throw new Error(`HTTP request timed out after ${timeout}ms`);
        }
        throw new Error(`HTTP request failed: ${error.message}`);
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}
