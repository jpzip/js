/** HTTP helpers with exponential-backoff retry for transient 5xx and network errors. */

import type { ZipcodeDict, Meta } from './types.js';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 200;

export interface FetchOptions {
  /** Override the global fetch (mainly for tests). */
  fetch?: typeof fetch;
  /** Pass-through to fetch(). */
  signal?: AbortSignal;
  /** Forces no-cache; useful when the user explicitly refreshes. */
  noCache?: boolean;
}

/**
 * fetchJSON returns the parsed JSON body for url. On 404 it returns null.
 * On 5xx / network errors it retries up to MAX_RETRIES with exponential backoff.
 * Other 4xx errors throw.
 */
export async function fetchJSON<T>(url: string, opts: FetchOptions = {}): Promise<T | null> {
  const f = opts.fetch ?? fetch;

  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(BASE_DELAY_MS * 2 ** attempt);
    }
    try {
      const init: RequestInit = {
        method: 'GET',
        headers: { Accept: 'application/json' },
      };
      if (opts.signal !== undefined) init.signal = opts.signal;
      if (opts.noCache) init.cache = 'no-cache';

      const res = await f(url, init);
      if (res.status === 404) return null;
      if (res.status >= 500) {
        lastErr = new Error(`jpzip: ${url} returned ${res.status}`);
        continue;
      }
      if (!res.ok) {
        throw new Error(`jpzip: ${url} returned ${res.status}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`jpzip: fetch failed for ${url}: ${String(lastErr)}`);
}

/** Convenience aliases with parameterized return types. */
export const fetchDict = (url: string, opts?: FetchOptions): Promise<ZipcodeDict | null> =>
  fetchJSON<ZipcodeDict>(url, opts);

export const fetchMeta = (url: string, opts?: FetchOptions): Promise<Meta | null> =>
  fetchJSON<Meta>(url, opts);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
