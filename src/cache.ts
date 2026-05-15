/**
 * Three-layer caching per spec §6.4:
 *
 *  - L1 (MemoryLRU)     — always on, bounded
 *  - L2 (PersistentCache) — opt-in via constructor
 *  - L3 (HTTP/fetch)    — out of SDK scope
 */

import type { ZipcodeDict } from './types.js';

/** Public interface user-supplied L2 caches must implement. */
export interface PersistentCache {
  get(key: string): Promise<Uint8Array | null>;
  set(key: string, value: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

/** Bounded in-memory LRU keyed by URL path. Values are pre-parsed dicts. */
export class MemoryLRU {
  private readonly max: number;
  private readonly map = new Map<string, ZipcodeDict>();

  constructor(max = 100) {
    this.max = Math.max(1, max);
  }

  get(key: string): ZipcodeDict | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // refresh recency by re-inserting at the tail
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: ZipcodeDict): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.max) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) this.map.delete(oldestKey);
    }
    this.map.set(key, value);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
