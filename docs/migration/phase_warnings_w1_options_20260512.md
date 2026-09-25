# W-1 方針調査レポート — middleware.ts 非推奨警告

**作成者**: CTO 真鍋玲央  
**調査日**: 2026-05-12  
**調査方法**: read-only（コード参照・node_modules 内アダプターコード調査・非実装）

---

## 警告原文ログ

```json
{
  "timestamp": "00:00:01.129",
  "source": "Server",
  "level": "WARN",
  "message": "⚠ The \"middleware\" file convention is deprecated. Please use \"proxy\" instead. Learn more: https://nextjs.org/docs/messages/middleware-to-proxy"
}
```

発生タイミング: `pnpm dev`（または `next dev`）サーバー起動のたびに毎回1回出力される。

---

## Phase CF-1 経緯サマリ

### なぜ middleware.ts を使っているか

| 時系列 | 状態 |
|--------|------|
| プロジェクト初期 | `src/middleware.ts` で Supabase セッション管理（Next.js 13〜15 の標準構成） |
| AGENTS.md 作成時 | 「middleware.ts は Next.js 16 で deprecated → proxy.ts を使用」と方針記載 |
| Phase CF-1（Cloudflare Workers デプロイ） | opennextjs-cloudflare が proxy.ts を未サポートであることが判明。middleware.ts を維持 |
| 現状（2026-05-12） | `src/middleware.ts` が稼働中・deprecation 警告が毎起動時に出る |

### middleware.ts の役割

```typescript
// src/middleware.ts
export async function middleware(request: NextRequest) {
  return await updateSession(request);
}
```

`updateSession()` は Supabase SSR の Cookie リフレッシュ・認証リダイレクトを担う。
**全リクエストに対してセッション管理が必要**なため、middleware（全リクエストインターセプト）での実装が必須。

### Next.js 16.2 のファイル規約変更

| 規約 | ファイル名 | 関数名 | ランタイム |
|------|-----------|-------|----------|
| 旧（Next.js 13〜15） | `middleware.ts` | `middleware()` | **Edge Runtime**（デフォルト）|
| 新（Next.js 16.2〜） | `proxy.ts` | `proxy()` | **Node.js Runtime**（Edge 非対応）|

**重要**: `proxy.ts` は Edge Runtime をサポートしない。

### opennextjs-cloudflare@1.19.6 の対応状況

`node_modules/@opennextjs/cloudflare/dist/cli/build/utils/middleware.js` の実装を確認:

```javascript
// middleware-manifest.json から middleware を探す（proxy 対応なし）
const edgeMiddleware = middlewareManifest.middleware["/"];
```

`node_modules/@opennextjs/cloudflare/dist/cli/build/open-next/createServerBundle.js`:

```javascript
// middleware.mjs のみコピー（proxy.mjs 対応コードなし）
fs.copyFileSync(path.join(options.buildDir, "middleware.mjs"), ...);
```

Cloudflare Workers デプロイ時のラッパーは `cloudflare-edge`（Edge Runtime 前提）。

**結論: opennextjs-cloudflare@1.19.6 は proxy.ts を未サポート。CHANGELOG / README にも proxy.ts への言及なし。**

---

## 方針案一覧（5案）

### 案 A: proxy.ts へリネーム（❌ 却下）

**内容**: `src/middleware.ts` を `src/proxy.ts` にリネーム、`export function middleware()` → `export function proxy()` に変更。

| 観点 | 評価 |
|------|------|
| メリット | Next.js 16.2 の警告が消える |
| デメリット | opennextjs-cloudflare が proxy.ts を読まない（middleware.mjs がビルドされない） → Workers 上で Supabase セッション管理が完全に壊れる |
| デメリット | proxy.ts は Node.js ランタイム専用。opennextjs-cloudflare の Edge Runtime ラッパー（cloudflare-edge）と非互換 |
| **Edge Runtime 影響** | **致命的**：Workers デプロイ後にすべての認証が動作しなくなる（ログイン不可・リダイレクト不可） |
| 工数 | 30 分（ただし本番が即壊れる） |
| **推奨度** | **❌ 絶対禁止** |

**注記**: AGENTS.md の「proxy.ts を使用せよ」という記載は Phase CF-1 以前のものであり、Cloudflare Workers 移行後は無効。**proxy.ts 移行は opennextjs-cloudflare が公式対応するまで実施禁止**。

---

### 案 B: 現状維持 + opennextjs アップデート監視（◎ 推奨）

**内容**: `src/middleware.ts` を変更しない。deprecation 警告は既知・許容の扱いとしてドキュメント化。opennextjs-cloudflare のリリースノートで proxy.ts 対応を監視する。

| 観点 | 評価 |
|------|------|
| メリット | コード変更ゼロ・本番機能への影響ゼロ・リスクゼロ |
| メリット | 警告は severity = WARN（機能的影響なし）であり放置してもユーザー体験に影響しない |
| デメリット | pnpm dev 起動のたびに警告が出続ける（視覚的なノイズ） |
| **Edge Runtime 影響** | **なし**（現状維持のため） |
| 工数 | 0 分（監視コスト: 月1回 opennextjs の GitHub Release を確認するのみ） |
| **推奨度** | **◎** |

**アクション**:  
- 本ドキュメントを「middleware.ts 警告は既知・Cloudflare Workers 移行起因」として記録（完了）  
- opennextjs-cloudflare の GitHub Releases で proxy.ts 対応が入った時点でマイグレーション実施

---

### 案 C: console.warn フィルタで警告を抑制（△）

**内容**: `next.config.ts` に `onDemandEntries` 等の設定を追加するか、`instrumentation.ts` で `console.warn` をオーバーライドして、middleware 警告文字列のみフィルタする。

```typescript
// next.config.ts（案 — 実装禁止）
const originalWarn = console.warn;
console.warn = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('middleware')) return;
  originalWarn(...args);
};
```

| 観点 | 評価 |
|------|------|
| メリット | 警告がターミナルに表示されなくなる |
| デメリット | Next.js が公式サポートする抑制方法ではない（ハック） |
| デメリット | `console.warn` のグローバル汚染。他の重要警告まで誤って消すリスク |
| デメリット | Next.js アップデート時に副作用が起きる可能性 |
| **Edge Runtime 影響** | なし（サーバー起動時のみのフィルタ）|
| 工数 | 1〜2 時間（テスト含む）|
| **推奨度** | **△**（警告ノイズが業務上深刻になった場合のみ検討）|

---

### 案 D: feature ブランチで proxy.ts を試験 + opennextjs upstream issue 起票（⭕）

**内容**: 
1. feature/proxy-ts ブランチを作成（本番影響なし）
2. proxy.ts に変更 → `pnpm preview`（opennextjs-cloudflare build）を実行して動作確認
3. 結果に応じて:
   - 動作した: main にマージして完了
   - 動作しない: opennextjs-cloudflare の GitHub に Issue を起票（「proxy.ts convention support request」）

| 観点 | 評価 |
|------|------|
| メリット | 実際に試して判断できる。opennextjs 側に要望を出すことでロードマップに影響できる |
| デメリット | `pnpm preview` の実行が必要（`pnpm build`と同等）。調査コスト 2〜3 時間 |
| デメリット | 現時点で opennextjs-cloudflare が proxy.ts を読まないことはコードで確認済みのため、動作しない可能性が高い |
| **Edge Runtime 影響** | 試験後に判明。ただし feature ブランチのため本番影響なし |
| 工数 | 2〜3 時間（試験 + Issue 起票）|
| **推奨度** | **⭕**（中期的に解決したい場合。今すぐでなくても良い）|

---

### 案 E: Next.js 設定で middleware のランタイムを明示（△）

**内容**: `src/middleware.ts` に `export const runtime = 'nodejs'` を追加して Node.js ランタイムを明示的に指定する。Next.js 16.2 の proxy.ts への移行要件（Node.js ランタイム）に近づける可能性を検討。

```typescript
// src/middleware.ts（案 — 実装禁止）
export const runtime = 'nodejs'; // 追加
export async function middleware(request: NextRequest) { ... }
```

| 観点 | 評価 |
|------|------|
| メリット | middleware.ts を維持しながらランタイムを Node.js 化できる可能性 |
| デメリット | opennextjs-cloudflare は Edge Runtime ラッパー（cloudflare-edge）前提。runtime='nodejs' を指定すると Workers のビルドで middleware が除外される可能性 |
| デメリット | Cloudflare Workers Free プランの CPU time 10ms 制限が Node.js ランタイムに適用されるかが不明 |
| **Edge Runtime 影響** | **不明・要実験**。Workers 上で middleware が動かなくなるリスクあり |
| 工数 | 30 分（feature ブランチで試験が前提）|
| **推奨度** | **△**（リスクが不明確なため推奨しない。先に案 D の試験が先決）|

---

## 推奨案と根拠

**推奨: 案 B（現状維持 + 監視）**

### 根拠

1. **機能的影響ゼロ**: deprecation WARN は毎起動1回出るが、本番ユーザーへの影響なし・エラーへの昇格もない
2. **opennextjs-cloudflare 側の制約**: アダプターが proxy.ts を読まないため、現時点で migrationは物理的に不可能
3. **リスク非対称**: 変更によるリスク（本番認証破損）>>放置のリスク（ターミナルノイズ）
4. **AGENTS.md との矛盾は既知事実として記録**: 「proxy.ts を使え」という記載はCloudflare Workers移行前の方針。現在のソース・オブ・トゥルースは本ドキュメント

### 中期アクション（別タスク・社長判断）

- opennextjs-cloudflare が proxy.ts 対応バージョンをリリースした時点で案 A を採用
- その判断タイミングを見届けるため、月1回の opennextjs GitHub Releases チェックをスケジュール化

---

## AGENTS.md 更新推奨（別タスク・社長判断）

現在 AGENTS.md に以下の矛盾記述がある:

```
- middleware.ts は Next.js 16 で deprecated → proxy.ts を使用
```

Cloudflare Workers 移行後の正しい記述に更新が必要:

```
- middleware.ts は Next.js 16.2 で deprecated だが、opennextjs-cloudflare が
  proxy.ts を未サポートのため middleware.ts を継続使用する（既知・意図的）
- proxy.ts への移行は opennextjs-cloudflare が公式対応したタイミングで実施
```

この更新は本タスクスコープ外。AGENTS.md 更新の判断を社長にお願いします。

---

*作成: CTO 真鍋玲央 / 2026-05-12*  
*調査方法: read-only（ソースコード・node_modules 参照のみ・ファイル編集なし）*
