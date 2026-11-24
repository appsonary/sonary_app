/**
 * Camada HTTP com timeout estrito via AbortController e isolamento de cookies.
 */

export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export interface HttpClient {
  fetch(url: string, init?: RequestInit, timeoutMs?: number): Promise<Response>;
}

export function createHttpClient(
  defaultTimeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS
): HttpClient {
  return {
    async fetch(
      url: string,
      init?: RequestInit,
      timeoutMs: number = defaultTimeoutMs
    ): Promise<Response> {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      try {
        const headers = {
          Accept: 'application/json',
          'User-Agent': 'SonaryMobile/1.0',
          ...(init?.headers || {}),
        };
        return await fetch(url, {
          ...init,
          // Evita que o CookieJar nativo anexe cookies de sessão WEB a chamadas anônimas (causa HTTP 403 no ExoPlayer)
          credentials: init?.credentials ?? 'omit',
          signal: controller.signal,
          headers,
        });
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}
