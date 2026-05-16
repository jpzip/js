# jpzip — TypeScript / JavaScript SDK

> 日本の郵便番号を CDN 配信の JSON データから引く SDK。`jpzip.nadai.dev` から取得する。

- 配信ドメイン: `https://jpzip.nadai.dev`
- プロトコル仕様: [`jpzip/spec`](https://github.com/jpzip/spec)
- データ ETL: [`jpzip/data`](https://github.com/jpzip/data)

## インストール

```sh
npm install @jpzip/jpzip
# or
pnpm add @jpzip/jpzip
```

## 使い方

### 関数 API

```ts
import { lookup, lookupGroup, lookupAll, preload, getMeta } from '@jpzip/jpzip';

const entry = await lookup('2310017');
// → { prefecture: '神奈川県', city: '横浜市中区', towns: [...], ... }

const dict231 = await lookupGroup('231'); // /p/231.json
const dict23  = await lookupGroup('23');  // /p/230.json - /p/239.json を並列 fetch
const dict2   = await lookupGroup('2');   // /g/2.json

const all = await lookupAll(); // /all.json (大きい)
const meta = await getMeta();
```

### クラス API (L2 キャッシュ・複数インスタンス用)

```ts
import { JpzipClient } from '@jpzip/jpzip';

const client = new JpzipClient({
  baseUrl: 'https://jpzip.nadai.dev',
  memoryCacheSize: 200,
  // 永続キャッシュ (Cache インターフェースを満たす任意の実装)
  cache: {
    async get(k) { /* ... */ return null; },
    async set(k, v) { /* ... */ },
    async delete(k) { /* ... */ },
    async clear() { /* ... */ },
  },
});

await client.preload({ scope: 'all' }); // オフラインモード相当
const entry = await client.lookup('2310017');
```

## キャッシュ戦略 (3 層)

| 層 | 目的 | 既定 |
|---|---|---|
| **L1 メモリ LRU** | 同一プロセスの重複 fetch 抑制 | 常時 ON、prefix 100 件保持 |
| **L2 永続キャッシュ** | 起動またぎ / preload 結果保持 | OFF、`cache` オプションで有効化 |
| **L3 HTTP** | ブラウザ / OS のキャッシュ | SDK 制御外 |

詳しくは [`jpzip/spec` §6.4](https://github.com/jpzip/spec/blob/main/spec/v1/protocol.md) を参照。

## API

| 関数 | 説明 |
|---|---|
| `lookup(zipcode)` | 単一 zipcode を引く。`null` は「見つからない」 |
| `lookupGroup(prefix)` | 1〜3 桁の prefix 配下を返す |
| `lookupAll()` | 全件辞書 (preload 用) |
| `preload({scope})` | `'all'` または prefix を SDK 内キャッシュに格納 |
| `getMeta()` | `/meta.json` を取得・キャッシュ |
| `isValidZipcode(zip)` | 7 桁数字フォーマット検証 |
| `configure(options)` | グローバルシングルトンのオプション差し替え |

## 入力検証

`lookup()` は `^\d{7}$` にマッチしない入力には fetch せず `null` を返す。

## バージョン整合性

`getMeta()` 初回呼び出し時、`spec_version` が SDK 対応バージョン (`"1.0"`) と異なる場合は `onSpecMismatch` コールバックを 1 回呼ぶ。`version` (データバージョン) が変わったらキャッシュを自動 invalidate。

## ライセンス

[MIT](./LICENSE)
