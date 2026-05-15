import { MemoryLRU, type PersistentCache } from './cache.js';
import { fetchDict, fetchMeta, type FetchOptions } from './fetch.js';
import type { Meta, ZipcodeDict, ZipcodeEntry } from './types.js';

export const DEFAULT_BASE_URL = 'https://jpzip.nadai.dev';
const SUPPORTED_SPEC = '1.0';

export interface JpzipClientOptions {
  /** Override the CDN origin. Defaults to https://jpzip.nadai.dev */
  baseUrl?: string;
  /** L2 persistent cache. Default off. */
  cache?: PersistentCache;
  /** Override fetch (mainly tests). */
  fetch?: typeof fetch;
  /** L1 LRU capacity in prefix count. Default 100. */
  memoryCacheSize?: number;
  /** Surface a warning to the user when spec_version mismatches. */
  onSpecMismatch?: (info: { expected: string; received: string }) => void;
}

const ZIP_REGEX = /^\d{7}$/;
const PREFIX_REGEX = /^\d{1,3}$/;

/**
 * JpzipClient is the SDK entrypoint. The functional shortcuts (`lookup`,
 * `lookupGroup`, …) below delegate to a default singleton instance backed
 * by L1 only.
 */
export class JpzipClient {
  private readonly baseUrl: string;
  private readonly cache: PersistentCache | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly mem: MemoryLRU;
  private readonly onSpecMismatch: JpzipClientOptions['onSpecMismatch'];
  private metaPromise: Promise<Meta | null> | null = null;
  private knownVersion: string | null = null;

  constructor(opts: JpzipClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.cache = opts.cache;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.mem = new MemoryLRU(opts.memoryCacheSize ?? 100);
    this.onSpecMismatch = opts.onSpecMismatch;
  }

  /** Returns the entry for `zipcode`, or null if not found. */
  async lookup(zipcode: string): Promise<ZipcodeEntry | null> {
    if (!ZIP_REGEX.test(zipcode)) return null;
    const prefix = zipcode.slice(0, 3);
    const dict = await this.fetchPrefixDict(prefix);
    if (!dict) return null;
    return dict[zipcode] ?? null;
  }

  /** Returns the dictionary for a 1- or 3-digit prefix (2-digit is fanned out). */
  async lookupGroup(prefix: string): Promise<ZipcodeDict> {
    if (!PREFIX_REGEX.test(prefix)) {
      throw new Error(`jpzip: invalid prefix ${JSON.stringify(prefix)} (must be 1-3 digits)`);
    }
    if (prefix.length === 3) {
      return (await this.fetchPrefixDict(prefix)) ?? {};
    }
    if (prefix.length === 1) {
      const dict = await this.fetchGroupDict(prefix);
      return dict ?? {};
    }
    // 2-digit fanout
    const tasks: Promise<ZipcodeDict | null>[] = [];
    for (let i = 0; i < 10; i++) {
      tasks.push(this.fetchPrefixDict(`${prefix}${i}`));
    }
    const dicts = await Promise.all(tasks);
    return Object.assign({}, ...dicts.filter(Boolean)) as ZipcodeDict;
  }

  /** Returns the full all.json (sizeable — for preload / batch use). */
  async lookupAll(): Promise<ZipcodeDict> {
    const dict = await fetchDict(`${this.baseUrl}/all.json`, this.fetchOpts());
    return dict ?? {};
  }

  /** Returns parsed meta.json, or null if the CDN has none yet. */
  async getMeta(): Promise<Meta | null> {
    if (this.metaPromise === null) {
      this.metaPromise = (async () => {
        const m = await fetchMeta(`${this.baseUrl}/meta.json`, this.fetchOpts());
        if (m && m.spec_version !== SUPPORTED_SPEC) {
          this.onSpecMismatch?.({ expected: SUPPORTED_SPEC, received: m.spec_version });
        }
        if (m && this.knownVersion && this.knownVersion !== m.version) {
          // data version changed — drop L1 + L2 to avoid stale reads
          this.mem.clear();
          await this.cache?.clear();
        }
        if (m) this.knownVersion = m.version;
        return m;
      })();
    }
    return this.metaPromise;
  }

  /**
   * preload pulls the requested scope into both L1 (per-prefix entries) and
   * L2 (when provided) so subsequent reads need no network.
   */
  async preload(opts: { scope: 'all' } | { scope: string }): Promise<void> {
    if (opts.scope === 'all') {
      const dict = await this.lookupAll();
      // Split into prefix buckets and prime L1.
      const buckets: Record<string, ZipcodeDict> = {};
      for (const [zip, entry] of Object.entries(dict)) {
        const p = zip.slice(0, 3);
        (buckets[p] ??= {})[zip] = entry;
      }
      for (const [p, b] of Object.entries(buckets)) {
        this.mem.set(this.prefixURL(p), b);
        await this.writeL2(this.prefixURL(p), b);
      }
      // Also keep the full dict accessible via the all.json URL key.
      this.mem.set(`${this.baseUrl}/all.json`, dict);
      await this.writeL2(`${this.baseUrl}/all.json`, dict);
      return;
    }
    if (PREFIX_REGEX.test(opts.scope)) {
      await this.lookupGroup(opts.scope);
      return;
    }
    throw new Error(`jpzip: invalid preload scope ${JSON.stringify(opts.scope)}`);
  }

  /** Clear all SDK-managed caches (L1 + L2). */
  async refresh(): Promise<void> {
    this.mem.clear();
    this.metaPromise = null;
    this.knownVersion = null;
    await this.cache?.clear();
  }

  /* ----------------------------- internals ------------------------------ */

  private async fetchPrefixDict(prefix: string): Promise<ZipcodeDict | null> {
    const url = this.prefixURL(prefix);
    const cached = this.mem.get(url);
    if (cached) return cached;

    const fromL2 = await this.readL2(url);
    if (fromL2) {
      this.mem.set(url, fromL2);
      return fromL2;
    }

    const dict = await fetchDict(url, this.fetchOpts());
    if (dict) {
      this.mem.set(url, dict);
      await this.writeL2(url, dict);
    }
    return dict;
  }

  private async fetchGroupDict(prefix1: string): Promise<ZipcodeDict | null> {
    const url = `${this.baseUrl}/g/${prefix1}.json`;
    const cached = this.mem.get(url);
    if (cached) return cached;
    const dict = await fetchDict(url, this.fetchOpts());
    if (dict) this.mem.set(url, dict);
    return dict;
  }

  private prefixURL(prefix3: string): string {
    return `${this.baseUrl}/p/${prefix3}.json`;
  }

  private fetchOpts(): FetchOptions {
    return { fetch: this.fetchImpl };
  }

  private async readL2(url: string): Promise<ZipcodeDict | null> {
    if (!this.cache) return null;
    const bytes = await this.cache.get(url);
    if (!bytes) return null;
    try {
      const text = new TextDecoder().decode(bytes);
      return JSON.parse(text) as ZipcodeDict;
    } catch {
      // corrupt cache — drop the entry and refetch
      await this.cache.delete(url);
      return null;
    }
  }

  private async writeL2(url: string, dict: ZipcodeDict): Promise<void> {
    if (!this.cache) return;
    const bytes = new TextEncoder().encode(JSON.stringify(dict));
    await this.cache.set(url, bytes);
  }
}
