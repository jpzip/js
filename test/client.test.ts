import { describe, expect, test } from 'vitest';
import { JpzipClient, MemoryLRU, type PersistentCache } from '../src/index.js';
import type { Meta, ZipcodeDict, ZipcodeEntry } from '../src/types.js';

const baseEntry: ZipcodeEntry = {
  prefecture: '神奈川県',
  prefecture_kana: 'カナガワケン',
  prefecture_roma: 'Kanagawa',
  prefecture_code: '14',
  city: '横浜市中区',
  city_kana: 'ヨコハマシナカク',
  city_roma: 'Yokohama Shi Naka Ku',
  city_code: '14104',
  towns: [{ town: '矢口台', kana: 'ヤグチダイ', roma: 'Yaguchidai' }],
};

const baseMeta: Meta = {
  version: '2026-05',
  generated_at: '2026-05-01T00:00:00Z',
  spec_version: '1.0',
  total_zipcodes: 1,
  prefix_count: 1,
  by_pref: { '14': 1 },
  data_source: 'https://www.post.japanpost.jp/service/search/zipcode/download/kogaki-zip.html',
  endpoints: { group: '/g/{prefix1}.json', prefix: '/p/{prefix3}.json' },
};

function mockFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    if (path in routes) {
      return new Response(JSON.stringify(routes[path]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not Found', { status: 404 });
  }) as typeof fetch;
}

describe('JpzipClient', () => {
  test('lookup returns null for malformed input without fetching', async () => {
    let called = 0;
    const client = new JpzipClient({
      fetch: (async () => {
        called++;
        return new Response('', { status: 500 });
      }) as typeof fetch,
    });
    expect(await client.lookup('abc')).toBeNull();
    expect(await client.lookup('12345')).toBeNull();
    expect(called).toBe(0);
  });

  test('lookup returns the matched entry', async () => {
    const dict: ZipcodeDict = { '2310831': baseEntry };
    const client = new JpzipClient({ fetch: mockFetch({ '/p/231.json': dict }) });
    const got = await client.lookup('2310831');
    expect(got).toEqual(baseEntry);
  });

  test('lookup hits the same prefix only once (L1)', async () => {
    let fetches = 0;
    const dict: ZipcodeDict = { '2310831': baseEntry };
    const f = (async (input: string | URL | Request) => {
      fetches++;
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.endsWith('/p/231.json')) {
        return new Response(JSON.stringify(dict), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    const client = new JpzipClient({ fetch: f });
    await client.lookup('2310831');
    await client.lookup('2310831');
    await client.lookup('2310832');
    expect(fetches).toBe(1);
  });

  test('lookupGroup with 2-digit prefix fans out to 10 fetches', async () => {
    let fetches = 0;
    const dict: ZipcodeDict = { '2310831': baseEntry };
    const f = (async (input: string | URL | Request) => {
      fetches++;
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.endsWith('/p/231.json')) {
        return new Response(JSON.stringify(dict), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    const client = new JpzipClient({ fetch: f });
    const out = await client.lookupGroup('23');
    expect(fetches).toBe(10);
    expect(out['2310831']).toEqual(baseEntry);
  });

  test('getMeta caches and surfaces spec mismatches', async () => {
    const seen: { expected: string; received: string }[] = [];
    const client = new JpzipClient({
      fetch: mockFetch({ '/meta.json': { ...baseMeta, spec_version: '2.0' } }),
      onSpecMismatch: (i) => seen.push(i),
    });
    await client.getMeta();
    await client.getMeta();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ expected: '1.0', received: '2.0' });
  });

  test('preload(all) fans out to /g/0..9 and seeds L1 for subsequent lookups', async () => {
    let fetches = 0;
    const dict: ZipcodeDict = { '2310831': baseEntry };
    const f = (async (input: string | URL | Request) => {
      fetches++;
      const url = typeof input === 'string' ? input : (input as URL).toString();
      // Only /g/2.json has data; the other 9 return 404 — the SDK should accept that.
      if (url.endsWith('/g/2.json')) return new Response(JSON.stringify(dict), { status: 200 });
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    const client = new JpzipClient({ fetch: f });
    await client.preload({ scope: 'all' });
    expect(fetches).toBe(10);
    const got = await client.lookup('2310831');
    expect(got).toEqual(baseEntry);
    expect(fetches).toBe(10);
  });

  test('L2 cache integration: dictionaries persist across instances', async () => {
    const store = new Map<string, Uint8Array>();
    const cache: PersistentCache = {
      async get(k) {
        return store.get(k) ?? null;
      },
      async set(k, v) {
        store.set(k, v);
      },
      async delete(k) {
        store.delete(k);
      },
      async clear() {
        store.clear();
      },
    };

    const dict: ZipcodeDict = { '2310831': baseEntry };
    let fetches = 0;
    const f = (async (input: string | URL | Request) => {
      fetches++;
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.endsWith('/p/231.json')) {
        return new Response(JSON.stringify(dict), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    const c1 = new JpzipClient({ fetch: f, cache });
    await c1.lookup('2310831');
    expect(fetches).toBe(1);

    // New instance — L1 is empty but L2 is shared.
    const c2 = new JpzipClient({ fetch: f, cache });
    const got = await c2.lookup('2310831');
    expect(got).toEqual(baseEntry);
    expect(fetches).toBe(1);
  });
});

describe('MemoryLRU', () => {
  test('evicts oldest entry when over capacity', () => {
    const cache = new MemoryLRU(2);
    cache.set('a', {});
    cache.set('b', {});
    cache.set('c', {});
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeDefined();
    expect(cache.get('c')).toBeDefined();
  });

  test('access refreshes recency', () => {
    const cache = new MemoryLRU(2);
    cache.set('a', {});
    cache.set('b', {});
    cache.get('a'); // a is now newer than b
    cache.set('c', {});
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBeDefined();
    expect(cache.get('c')).toBeDefined();
  });
});
