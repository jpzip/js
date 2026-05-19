## jpzip-js

[![npm version](https://img.shields.io/npm/v/@jpzip/jpzip.svg)](https://www.npmjs.com/package/@jpzip/jpzip)
[![types: included](https://img.shields.io/npm/types/@jpzip/jpzip.svg)](https://www.npmjs.com/package/@jpzip/jpzip)
[![Docs](https://img.shields.io/badge/docs-jpzip.nadai.dev-0066cc.svg)](https://jpzip.nadai.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Test](https://github.com/jpzip/js/actions/workflows/test.yml/badge.svg)](https://github.com/jpzip/js/actions/workflows/test.yml)

> **jpzip** の TypeScript / JavaScript SDK — 無料・無制限の日本郵便番号 API。
> 日本郵便の `KEN_ALL.csv` / `KEN_ALL_ROME.csv` を JSON 正規化し CDN 配信。

[English](./README.md) | **日本語**

`@jpzip/jpzip` は `jpzip.nadai.dev` から日本の郵便番号 120,677 件を引く TypeScript SDK です。
登録不要、レート制限なし、API キー不要。

- 🇯🇵 **全件収録** — 漢字・カナ・ローマ字・自治体コード(JIS X 0401 / 総務省地方公共団体コード)
- ⚡️ **高速** — L1 LRU + 任意の L2 永続キャッシュ。`preload` でネットワーク往復なしのルックアップが可能
- 🛡️ **堅牢** — 5xx / ネットワーク失敗時は指数バックオフで最大 3 回リトライ
- 🪶 **ランタイム依存ゼロ** — プラットフォーム標準の `fetch` のみ使用
- 🧰 **型安全** — TypeScript ファーストクラス、ESM + CJS デュアルビルド
- 🆓 **永久無料** — Cloudflare Pages 無料枠で運用(課金軸が存在しない)
- 🔌 **同一 API** — [全 jpzip SDK](#他言語版) で API が揃う

## 必要環境

Node.js 18+(または `fetch` が標準搭載されたランタイム — Bun、Deno、モダンブラウザ、Cloudflare Workers、Vercel Edge)。

## インストール

```bash
npm install @jpzip/jpzip
# または
pnpm add @jpzip/jpzip
# または
yarn add @jpzip/jpzip
```

## クイックスタート

```ts
import { lookup } from '@jpzip/jpzip';

const entry = await lookup('2310017');
if (entry === null) {
  console.log('見つかりません');
} else {
  console.log(entry.prefecture, entry.city, entry.towns[0].town);
  // 出力: 神奈川県 横浜市中区 港町
}
```

ローマ字・自治体コードも同じエントリに含まれます:

```ts
console.log(entry.prefecture_roma, entry.city_roma, entry.towns[0].roma);
// 出力: Kanagawa Ken Yokohama Shi Naka Ku Minatocho

console.log(entry.prefecture_code, entry.city_code);
// 出力: 14 14104
```

## ユースケース

### 郵便番号ルックアップ HTTP エンドポイント (Hono)

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

Node / Bun / Cloudflare Workers / Vercel Edge でそのまま動作します。

### 郵便番号ルックアップ HTTP エンドポイント (Express)

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

### CSV のバッチ検証

```ts
import { lookupAll } from '@jpzip/jpzip';

const all = await lookupAll(); // 全件をメモリに展開(JSON 約 37 MiB)
for (const zip of csvZipcodes) {
  if (!(zip in all)) {
    console.warn(`不正な郵便番号: ${zip}`);
  }
}
```

### キャッシュからの提供(任意の L2 バックエンド)

データは 948 個の 3 桁 prefix バケットに分割されています。デフォルト L1 (100 件) は
ホットなバケットを保持しますが、全件を常駐させるには L2 を併用するか
`memoryCacheSize` を 948 超に設定してください。

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
// 以降の lookup は L1/L2 で完結し、ネットワークにアクセスしない
const entry = await client.lookup('2310017');
```

## API リファレンス

### 関数(モジュールレベル、内部の default `JpzipClient` シングルトンを共有)

| 関数 | 説明 |
|---|---|
| `lookup(zipcode)` | 7 桁の郵便番号で 1 件引く。見つからない / 不正な入力は `null`(不正入力時はネットワーク不使用)。 |
| `lookupGroup(prefix)` | 1〜3 桁の prefix で引く。1 桁は `/g/{d}.json` を 1 回、3 桁は `/p/{ddd}.json` を 1 回、2 桁は 10 並列 fetch して結合。数字以外を含む入力では throw。 |
| `lookupAll()` | `/g/0..9.json` を並列取得して全件(120k 件、約 37 MiB)を返す。 |
| `getMeta()` | データバージョン・生成日時・都道府県別件数・spec version。client の `refresh()` を呼ぶまで結果をキャッシュ。 |
| `preload({ scope })` | `'all'` または 1〜3 桁の prefix で L1(L2 設定時は L2 も)を温める。 |
| `isValidZipcode(zip)` | 純粋な書式チェック(`^\d{7}$`)。ネットワーク不使用。 |
| `configure(options)` | シングルトンを差し替え、以降の関数呼び出しに新オプションを適用。 |

### `JpzipClient`(高度な用途)

L2 キャッシュ、`fetch` 差し替え、配信元変更、複数の独立キャッシュが必要な場合にインスタンスを直接生成します:

```ts
import { JpzipClient } from '@jpzip/jpzip';

const client = new JpzipClient({
  baseUrl: 'https://jpzip.nadai.dev',
  fetch: globalThis.fetch,            // 任意で差し替え
  memoryCacheSize: 200,               // L1 容量(prefix バケット数)、デフォルト 100
  cache: myPersistentCache,           // L2(任意)
  onSpecMismatch: ({ expected, received }) => {
    console.warn(`jpzip spec 不一致: SDK=${expected} server=${received}`);
  },
});
```

`JpzipClient` は `lookup` / `lookupGroup` / `lookupAll` / `getMeta` / `preload` に加えて:

| メソッド | 説明 |
|---|---|
| `client.refresh()` | L1(L2 設定時は L2 も)を消し、キャッシュ済み meta を破棄。 |

`getMeta()` が `/meta.json` の `version` 変更を検知すると L1/L2 が自動クリアされます。
データ切り替えに追従するには `getMeta()` を定期的に呼んでください。

### エラー

- `lookup()` は「見つからない」「書式不正」いずれの場合も throw せず `null` を返します。
- `lookupGroup(prefix)` は `prefix` が `/^\d{1,3}$/` に一致しない場合 `Error` を throw。
- ネットワーク失敗と 5xx は最大 3 回試行(初回 + リトライ 2 回)、指数バックオフのスリープは 400ms / 800ms。404 以外の 4xx は即時 throw、404 は `null` 返却。`AbortError` はリトライせず再 throw。

### `PersistentCache` インターフェース

任意の L2 バックエンド(ファイル / IndexedDB / Redis / Cloudflare KV など)を渡せます:

```ts
export interface PersistentCache {
  get(key: string): Promise<Uint8Array | null>;
  set(key: string, value: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}
```

キーは prefix バケットの完全 URL(例: `https://jpzip.nadai.dev/p/231.json`)、値は生 JSON バイト列。

### エクスポートされる型

`ZipcodeEntry` / `Town` / `Meta` / `ZipcodeDict` / `Endpoints` / `JpzipClientOptions` / `PersistentCache` — すべて `@jpzip/jpzip` から import 可能。

## なぜ jpzip-js か

| | **jpzip-js** | [jpostcode][jpostcode] | [jposta][jposta] | [@ken-all/kenall][kenall] |
|---|---|---|---|---|
| ローマ字(`Yokohama Shi`) | ✅ | ❌ | ❌ | ⚠️ オプション |
| 自治体コード(JIS / 総務省) | ✅ | ❌ | ⚠️ `prefNum` のみ | ✅ |
| カナ | ✅ | ✅ | ❌ | ✅ |
| ビルドに数 MB のデータを同梱しない | ✅ CDN fetch | ⚠️ npm 版は同梱 | ❌ JSON 同梱 | ✅ |
| `npm install` 不要で月次更新 | ✅ CDN で自動 | ❌ 月次再公開 | ❌ 手動 | ✅ |
| API キー不要 | ✅ | ✅ | ✅ | ❌ 必須 |
| レート制限なし | ✅ | ✅ | ✅ | ⚠️ プラン依存 |
| L1 + 差し替え可能な L2 | ✅ | ❌ | ❌ | ❌ |
| ランタイム依存ゼロ | ✅ | ✅ | ✅ | ❌ (`zod`) |
| ESM + CJS + TypeScript 型 | ✅ | ✅ | ✅ | ✅ |

[jpostcode]: https://www.npmjs.com/package/jpostcode
[jposta]: https://www.npmjs.com/package/jposta
[kenall]: https://www.npmjs.com/package/@ken-all/kenall

## 他言語版

全 SDK で同一の API を提供しています:

[Go](https://github.com/jpzip/go) · [Python](https://github.com/jpzip/python) · [Rust](https://github.com/jpzip/rust) · [Ruby](https://github.com/jpzip/ruby) · [PHP](https://github.com/jpzip/php) · [Swift](https://github.com/jpzip/swift) · [Dart](https://github.com/jpzip/dart)

## 関連リソース

- **Web サイト** — https://jpzip.nadai.dev
- **プロトコル仕様** — [jpzip/spec](https://github.com/jpzip/spec)
- **データ ETL** — [jpzip/data](https://github.com/jpzip/data)
- **MCP サーバー** — [jpzip/mcp](https://github.com/jpzip/mcp) — Claude / ChatGPT / Cursor から jpzip を呼ぶ

## キーワード

日本郵便番号, 郵便番号, KEN_ALL, KEN_ALL_ROME, 住所バリデーション, 住所検索, japanese postal code, japan zipcode, postal code lookup typescript, typescript japanese address, node.js zipcode, hono 郵便番号, express 郵便番号, cloudflare workers 住所, JIS X 0401, 総務省地方公共団体コード

## ライセンス

[MIT](./LICENSE)
