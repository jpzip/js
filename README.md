## jpzip-js

[![npm version](https://img.shields.io/npm/v/@jpzip/jpzip.svg)](https://www.npmjs.com/package/@jpzip/jpzip)
[![types: included](https://img.shields.io/npm/types/@jpzip/jpzip.svg)](https://www.npmjs.com/package/@jpzip/jpzip)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Test](https://github.com/jpzip/js/actions/workflows/test.yml/badge.svg)](https://github.com/jpzip/js/actions/workflows/test.yml)

> TypeScript / JavaScript SDK for **jpzip** — a free, unlimited Japanese postal code (郵便番号) API.
> 日本の全郵便番号 120,677 件を CDN 配信 JSON から引く TypeScript SDK。

**English** | [日本語](./README.ja.md)

`@jpzip/jpzip` looks up Japanese postal codes (郵便番号) from `jpzip.nadai.dev`,
a CDN-hosted dataset built from Japan Post's `KEN_ALL.csv` and `KEN_ALL_ROME.csv`
normalized to JSON. No registration, no rate limits, no API key.

- 🇯🇵 **Complete dataset** — 120,677 entries with kanji, kana, romaji, and government codes (JIS X 0401 / 総務省地方公共団体コード)
- ⚡️ **Fast** — L1 LRU + optional L2 persistent cache; `preload` to serve lookups without per-request network round-trips
- 🛡️ **Resilient** — up to 3 attempts with exponential backoff on 5xx / network failures
- 🪶 **Zero runtime deps** — uses the platform `fetch` only
- 🧰 **Typed end to end** — first-class TypeScript, ESM + CJS dual build
- 🆓 **Free forever** — backed by Cloudflare Pages' free tier (no billing axis exists)
- 🔌 **Drop-in** — same API surface across [every jpzip SDK](#other-languages)

## Requirements

Node.js 18+ (or any runtime with a global `fetch` — Bun, Deno, modern browsers, Cloudflare Workers, Vercel Edge).

## Install

```bash
npm install @jpzip/jpzip
# or
pnpm add @jpzip/jpzip
# or
yarn add @jpzip/jpzip
```

## Quick Start

```ts
import { lookup } from '@jpzip/jpzip';

const entry = await lookup('2310017');
if (entry === null) {
  console.log('not found');
} else {
  console.log(entry.prefecture, entry.city, entry.towns[0].town);
  // Output: 神奈川県 横浜市中区 港町
}
```

Romaji and government codes are included on the same entry:

```ts
console.log(entry.prefecture_roma, entry.city_roma, entry.towns[0].roma);
// Output: Kanagawa Ken Yokohama Shi Naka Ku Minatocho

console.log(entry.prefecture_code, entry.city_code);
// Output: 14 14104
```

## Use Cases

### Zipcode lookup HTTP endpoint (Hono)

```ts
import { Hono } from 'hono';
import { lookup } from '@jpzip/jpzip';

const app = new Hono();

app.get('/api/zipcode/:code', async (c) => {
  const entry = await lookup(c.req.param('code'));
  if (entry === null) return c.notFound();
  return c.json(entry);
});

export default app;
```

Works unchanged on Node, Bun, Cloudflare Workers, and Vercel Edge.

### Zipcode lookup HTTP endpoint (Express)

```ts
import express from 'express';
import { lookup } from '@jpzip/jpzip';

const app = express();

app.get('/api/zipcode/:code', async (req, res, next) => {
  try {
    const entry = await lookup(req.params.code);
    if (entry === null) return res.status(404).end();
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

app.listen(3000);
```

### Batch validation

```ts
import { lookupAll } from '@jpzip/jpzip';

const all = await lookupAll(); // entire dataset in memory (~37 MiB JSON)
for (const zip of csvZipcodes) {
  if (!(zip in all)) {
    console.warn(`invalid zipcode: ${zip}`);
  }
}
```

### Serve lookups from cache (BYO L2 backend)

The dataset is partitioned into 948 three-digit prefix buckets. The default
L1 (100 entries) keeps the hottest buckets; to cache the whole dataset, pair
`preload({ scope: 'all' })` with an L2 cache or raise `memoryCacheSize` above 948.

```ts
import { JpzipClient, type PersistentCache } from '@jpzip/jpzip';
import { readFile, writeFile, unlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const dir = '.jpzip-cache';
const path = (key: string) => join(dir, createHash('sha1').update(key).digest('hex'));

const fileCache: PersistentCache = {
  async get(key) {
    try {
      return await readFile(path(key));
    } catch {
      return null;
    }
  },
  async set(key, value) {
    await writeFile(path(key), value);
  },
  async delete(key) {
    await unlink(path(key)).catch(() => {});
  },
  async clear() {
    await rm(dir, { recursive: true, force: true });
  },
};

const client = new JpzipClient({
  memoryCacheSize: 1024,
  cache: fileCache,
});

await client.preload({ scope: 'all' });
// Subsequent lookups are served from L1/L2 without hitting the network.
const entry = await client.lookup('2310017');
```

## API Reference

### Functions (module-level, share a default `JpzipClient` singleton)

| Function | Description |
|---|---|
| `lookup(zipcode)` | Look up a single 7-digit zipcode. Returns `null` for not-found or malformed input (no network call for malformed input). |
| `lookupGroup(prefix)` | Look up by 1-, 2-, or 3-digit prefix. 1-digit fetches `/g/{d}.json`; 3-digit fetches `/p/{ddd}.json`; 2-digit fans out into 10 parallel 3-digit fetches and merges. Throws on non-digit input. |
| `lookupAll()` | Fetch entire dataset (120k entries, ~37 MiB) in parallel across `/g/0..9.json`. |
| `getMeta()` | Dataset version, generated-at, per-prefecture counts, spec version. Result is cached until `refresh()` is called on the client. |
| `preload({ scope })` | Warm L1 (and L2 when configured) for `'all'` or a specific 1-3 digit prefix. |
| `isValidZipcode(zip)` | Pure syntax check (`^\d{7}$`) — no network. |
| `configure(options)` | Replace the singleton with a new `JpzipClient` configured with `options`. |

### `JpzipClient` (advanced)

Construct an instance for L2 caching, custom `fetch`, alternate base URL, or
multiple isolated caches:

```ts
import { JpzipClient } from '@jpzip/jpzip';

const client = new JpzipClient({
  baseUrl: 'https://jpzip.nadai.dev',
  fetch: globalThis.fetch,            // optional override
  memoryCacheSize: 200,               // L1 capacity in prefix buckets, default 100
  cache: myPersistentCache,           // optional L2
  onSpecMismatch: ({ expected, received }) => {
    console.warn(`jpzip spec mismatch: SDK=${expected} server=${received}`);
  },
});
```

`JpzipClient` exposes `lookup` / `lookupGroup` / `lookupAll` / `getMeta` / `preload` plus:

| Method | Description |
|---|---|
| `client.refresh()` | Wipe L1 (and L2 when configured) and forget the cached meta. |

When `getMeta()` observes that `/meta.json`'s `version` has changed since the last
successful fetch, L1 and L2 are cleared automatically — call `getMeta()` periodically
to pick up dataset rollovers.

### Errors

- `lookup()` returns `null` rather than throwing for both "not found" and malformed input.
- `lookupGroup(prefix)` throws `Error` if `prefix` doesn't match `/^\d{1,3}$/`.
- Transient network failures and 5xx responses are retried up to 3 attempts (initial + 2 retries) with exponential backoff sleeps of 400ms and 800ms. 4xx responses other than 404 throw immediately; 404 yields `null`. `AbortError` propagates without retry.

### `PersistentCache` interface

Bring your own L2 backend (file system, IndexedDB, Redis, Cloudflare KV, etc.):

```ts
export interface PersistentCache {
  get(key: string): Promise<Uint8Array | null>;
  set(key: string, value: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}
```

Keys are the full bucket URLs (e.g. `https://jpzip.nadai.dev/p/231.json`); values
are raw JSON bytes.

### Exported types

`ZipcodeEntry`, `Town`, `Meta`, `ZipcodeDict`, `Endpoints`, `JpzipClientOptions`,
`PersistentCache` — all importable from `@jpzip/jpzip`.

## Why jpzip-js?

| | **jpzip-js** | [jpostcode][jpostcode] | [jposta][jposta] | [@ken-all/kenall][kenall] |
|---|---|---|---|---|
| Romaji (`Yokohama Shi`) | ✅ | ❌ | ❌ | ⚠️ Optional field |
| Government codes (JIS / 総務省) | ✅ | ❌ | ⚠️ `prefNum` only | ✅ |
| Kana | ✅ | ✅ | ❌ | ✅ |
| No bundled multi-MB data in your build | ✅ CDN fetch | ⚠️ npm version embeds data | ❌ Embedded JSON | ✅ |
| Monthly updates without re-`npm install` | ✅ Auto via CDN | ❌ Republished monthly | ❌ Manual | ✅ |
| No API key | ✅ | ✅ | ✅ | ❌ Required |
| Rate-limit-free | ✅ | ✅ | ✅ | ⚠️ Plan-based quota |
| L1 + pluggable L2 cache | ✅ | ❌ | ❌ | ❌ |
| Zero runtime deps | ✅ | ✅ | ✅ | ❌ (`zod`) |
| ESM + CJS + TypeScript types | ✅ | ✅ | ✅ | ✅ |

[jpostcode]: https://www.npmjs.com/package/jpostcode
[jposta]: https://www.npmjs.com/package/jposta
[kenall]: https://www.npmjs.com/package/@ken-all/kenall

## Other Languages

Same API surface across all SDKs:

[Go](https://github.com/jpzip/go) · [Python](https://github.com/jpzip/python) · [Rust](https://github.com/jpzip/rust) · [Ruby](https://github.com/jpzip/ruby) · [PHP](https://github.com/jpzip/php) · [Swift](https://github.com/jpzip/swift) · [Dart](https://github.com/jpzip/dart)

## Resources

- **Website** — https://jpzip.nadai.dev
- **Protocol spec** — [jpzip/spec](https://github.com/jpzip/spec)
- **Data ETL** — [jpzip/data](https://github.com/jpzip/data)
- **MCP server** — [jpzip/mcp](https://github.com/jpzip/mcp) — use jpzip from Claude / ChatGPT / Cursor

## Keywords

japanese postal code, japan zipcode, 郵便番号, KEN_ALL, KEN_ALL_ROME, address validation, postal code lookup typescript, typescript japanese address, node.js zipcode, hono postal code, express zipcode, cloudflare workers japan address, JIS X 0401, 総務省地方公共団体コード

## License

[MIT](./LICENSE)
