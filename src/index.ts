export { JpzipClient, DEFAULT_BASE_URL, type JpzipClientOptions } from './client.js';
export { MemoryLRU, type PersistentCache } from './cache.js';
export type { ZipcodeEntry, Town, Meta, ZipcodeDict, Endpoints } from './types.js';

import { JpzipClient } from './client.js';
import type { Meta, ZipcodeDict, ZipcodeEntry } from './types.js';

/**
 * The functional helpers below all delegate to a lazily-initialized default
 * client (L1 cache only, default base URL). For multiple SDK instances or
 * an L2 cache, construct `new JpzipClient({...})` yourself.
 */

let _default: JpzipClient | null = null;
function defaultClient(): JpzipClient {
  if (_default === null) _default = new JpzipClient();
  return _default;
}

/** Reset the singleton (mainly for tests). */
export function _resetDefaultClient(): void {
  _default = null;
}

/** Configure the singleton's options. Subsequent calls re-create the client. */
export function configure(options: ConstructorParameters<typeof JpzipClient>[0]): void {
  _default = new JpzipClient(options);
}

export const lookup = (zipcode: string): Promise<ZipcodeEntry | null> =>
  defaultClient().lookup(zipcode);

export const lookupGroup = (prefix: string): Promise<ZipcodeDict> =>
  defaultClient().lookupGroup(prefix);

export const lookupAll = (): Promise<ZipcodeDict> => defaultClient().lookupAll();

export const preload = (opts: Parameters<JpzipClient['preload']>[0]): Promise<void> =>
  defaultClient().preload(opts);

export const getMeta = (): Promise<Meta | null> => defaultClient().getMeta();

/** Helper: returns true iff `zip` is a syntactically valid 7-digit zipcode. */
export function isValidZipcode(zip: string): boolean {
  return /^\d{7}$/.test(zip);
}
