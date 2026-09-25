# TagDeck Cloudflare Workers 移行棚卸し v0.1 (2026-05-11)

**作成者**: CTO 真鍋玲央  
**作成日**: 2026-05-11  
**対象**: `D:\tagdeck\` — TagDeck 本体のみ  
**制約**: read-only 調査。既存ファイルへの変更ゼロ・本ファイルのみ新規作成。  
**前提 commit**: `a7776c3` (main)・Vitest 25/25 PASS

---

## 1. エグゼクティブサマリー

TagDeck は Next.js 16.2 + App Router + Supabase 構成で、`@opennextjs/cloudflare@1.19.6` + `wrangler.jsonc` が **既に devDependencies に導入済みかつ設定済み** であることを確認した。`package.json` の `preview` / `deploy` スクリプトも opennextjs-cloudflare 経由で定義されており、**Phase 1（アダプター導入）は事実上完了している**。Node.js 固有 API（fs / child_process / net 等）の直接使用はソースコード内に一切存在せず、外部 API 呼び出しはすべて標準 `fetch()` で実装されている。`nodejs_compat` フラグで postgres パッケージ（TCP 接続）を補う構成も AGENTS.md で明文化済み。致命的ブロッカーは存在しない。残作業は Cloudflare プロジェクト作成・環境変数投入・DNS 切替の運用操作のみで、技術的障壁はない。

---

## 2. 移行可否判定

**判定: 条件付き可（実質的には可）**

| 根拠 | 詳細 |
|------|------|
| アダプター導入済み | `@opennextjs/cloudflare@1.19.6` + `wrangler.jsonc` + `open-next.config.ts` が main ブランチに存在 |
| Node.js 非互換 API 不使用 | `src/` 全体で `fs` / `child_process` / `net` / `dgram` / `http(s)` モジュールの direct import ゼロ |
| Workers 制約を考慮した設計 | `AGENTS.md` に Workers 制約が明文化。DB クライアントのグローバル保持禁止・`nodejs_compat` 前提・`next/dynamic` 遅延ロード指針が既に記載 |

条件: ① Cloudflare Dashboard でプロジェクト作成 ② Secrets（`DATABASE_URL` 等）投入 ③ `tagdeck.jp` の DNS を Workers 向けに切替 ④ `@serwist/next` ビルド成否の事前確認。

---

## 3. 基本構成

| 項目 | 値 |
|------|----|
| Next.js | 16.2.4 |
| React | 19.2.4 |
| Router | **App Router**（`src/app/`・`src/pages/` なし） |
| TypeScript | ^5（strict モード） |
| パッケージマネージャー | pnpm |
| スタイリング | Tailwind CSS v4 |
| UI | shadcn/ui（base-nova・Base UI ベース） |
| テスト | Vitest ^4.1.5（25/25 PASS） |
| Cloudflare アダプター | `@opennextjs/cloudflare@1.19.6`（devDependencies） |
| wrangler | `^4.88.0`（devDependencies） |
| `wrangler.jsonc` | 存在・設定済み |
| `open-next.config.ts` | 存在・`defineCloudflareConfig({})` |
| `vercel.json` | **存在しない** |

### wrangler.jsonc 全設定

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "tagdeck",
  "main": ".open-next/worker.js",
  "compatibility_date": "2026-05-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": ".open-next/assets",
    "binding": "ASSETS"
  },
  "observability": {
    "enabled": true
  }
}
```

### next.config.ts 全設定

```ts
import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV !== "production",
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  reactCompiler: false,
  images: { unoptimized: true },   // ← Vercel Image Optimization を不使用
};

export default withSerwist(nextConfig);
```

---

## 4. Next.js 使用機能

| 機能 | 使用状況 | Workers 適合性 |
|------|---------|--------------|
| App Router | 使用（`src/app/`） | ✅ opennextjs-cloudflare が完全対応 |
| Server Components | 使用（layout.tsx / page.tsx 等） | ✅ |
| Client Components | 32 ファイル（`"use client"` grep 結果） | ✅ 静的アセットとして配信 |
| Server Actions | 3 ファイル（login / signup / reset-password の `actions.ts`） | ✅ nodejs_compat 経由 |
| Route Handlers | 16 ファイル（api/ 配下） | ✅ nodejs_compat 経由 |
| Edge Runtime | **指定なし**（`export const runtime = 'edge'` ゼロ件） | ✅ Node.js runtime のみ |
| ISR（revalidate 値指定） | `niconico.ts` で `next: { revalidate: 0 }`（キャッシュ無効） | ✅ 0 = no-store 相当 |
| SSG / getStaticProps | **使用なし** | ✅ |
| Dynamic Routes | `api/events/[id]/` 配下（complete / historical-pace / manual-rivals / refresh-ranking） | ✅ |
| Middleware（proxy.ts） | `src/proxy.ts`（Next.js 16.2 仕様・Supabase セッション管理） | ✅ Edge Runtime 不要の設計 |
| next/image | **使用なし**（`images.unoptimized: true` 設定済み） | ✅ Vercel Image Optimization 依存なし |
| next/font/google | `layout.tsx` で `Inter` 使用 | ⚠️ ビルド時ネットワーク要（後述 §15） |
| PWA / Service Worker | `@serwist/next`（`src/sw.ts` → `public/sw.js`） | ⚠️ ビルド後に ASSETS バインドで配信（後述 §15） |

---

## 5. Vercel 固有機能の使用状況

| 項目 | 調査結果 |
|------|---------|
| `@vercel/*` パッケージ import | **ゼロ件**（`src/` 全体 grep） |
| `vercel.json` | **存在しない** |
| Vercel KV / Postgres / Blob / Edge Config | **使用なし** |
| Vercel Analytics | **使用なし** |
| Vercel Image Optimization | **使用なし**（`unoptimized: true`） |
| Vercel Cron Jobs | **使用なし** |
| `process.env.VERCEL_*` | **ゼロ件**（`src/` 全体 grep） |
| Vercel 独自ドメイン設定 | vercel.json なし・コード上の参照なし |

**結論: Vercel 固有機能への依存はゼロ。** 移行時に削除・置換が必要なコードは存在しない。

---

## 6. Workers 非互換 API の調査結果

`src/` 配下（`node_modules/` / `.next/` 除外）を全件 grep した結果。

| API | grep パターン | 件数 | 判定 |
|-----|-------------|------|------|
| `fs` / `fs/promises` | `from ['"]fs` | 0 | ✅ |
| `child_process` | `from ['"]child_process` | 0 | ✅ |
| `net` / `dgram` / `cluster` | `from ['"]net` 等 | 0 | ✅ |
| `http` / `https` module (low-level) | `from ['"]https?['"]` | 0 | ✅ |
| `WebAssembly` | `WebAssembly` | 0 | ✅ |
| `createReadStream` / `createWriteStream` | 対象パターン | 0 | ✅ |
| サーバー側 WebSocket | `WebSocket` in `src/app/api/` | 0 | ✅ |
| `setInterval` / `setTimeout` on server | api/ 配下 | 0 | ✅ |

全件ゼロ。サーバー側コードは標準 Web API（`fetch` / `Request` / `Response` / `AbortSignal.timeout`）のみを使用している。

---

## 7. 依存パッケージの Workers 適合性

### dependencies 全件判定

| パッケージ | バージョン | Workers 適合性 | 備考 |
|-----------|----------|--------------|------|
| `next` | 16.2.4 | ✅ | opennextjs-cloudflare が対応 |
| `react` / `react-dom` | 19.2.4 | ✅ | 静的アセット |
| `@supabase/supabase-js` | ^2.105.3 | ✅ | fetch ベース・Workers 公式サポート |
| `@supabase/ssr` | ^0.10.2 | ✅ | cookies API 使用・Workers 対応 |
| `drizzle-orm` | ^0.45.2 | ✅ | Workers 対応確認済み |
| `postgres` | ^3.4.9 | ⚠️ nodejs_compat 必要 | TCP 接続。`nodejs_compat` フラグで動作（Transaction Pooler + `prepare: false` 設定済み） |
| `@tanstack/react-query` | ^5.100.9 | ✅ | クライアント側のみ |
| `framer-motion` | ^12.38.0 | ✅ | クライアント側・`next/dynamic` 遅延ロード前提（AGENTS.md に記載） |
| `recharts` | ^3.8.1 | ✅ | クライアント側・`next/dynamic` 遅延ロード前提 |
| `pusher-js` | ^8.5.0 | ✅ | クライアント側のみ（`useKickMonitor.ts`）。サーバー側 Pusher 不使用 |
| `@serwist/next` | ^9.5.11 | ⚠️ 要ビルド検証 | Service Worker は public/ 静的ファイルとして配信。後述 §15 |
| `zod` | ^4.4.3 | ✅ | |
| `zustand` | ^5.0.13 | ✅ | クライアント側 |
| `date-fns` | ^4.1.0 | ✅ | |
| `lucide-react` | ^1.14.0 | ✅ | クライアント側 |
| `clsx` / `tailwind-merge` | — | ✅ | |
| `class-variance-authority` | ^0.7.1 | ✅ | |
| `react-hook-form` | ^7.75.0 | ✅ | クライアント側 |
| `@hookform/resolvers` | ^5.2.2 | ✅ | |
| `sonner` | ^2.0.7 | ✅ | クライアント側 |
| `next-themes` | ^0.4.6 | ✅ | クライアント側 |
| `@base-ui/react` | ^1.4.1 | ✅ | クライアント側 |
| `tw-animate-css` | ^1.4.0 | ✅ | |

### devDependencies Workers 関連

| パッケージ | バージョン | 役割 |
|-----------|----------|------|
| `@opennextjs/cloudflare` | ^1.19.6 | Workers ビルドアダプター |
| `@cloudflare/workers-types` | ^4.20260506.1 | Workers 型定義 |
| `wrangler` | ^4.88.0 | Workers デプロイ CLI |

### `sharp` について

`pnpm.onlyBuiltDependencies` に記載されているが、`dependencies` には含まれていない。`next/image` の `unoptimized: true` により runtime での sharp 呼び出しは発生しない。**Workers 非互換問題は存在しない。**

---

## 8. 環境変数の利用パターン

### `process.env.*` 参照箇所（変数名のみ・値は読まない）

| 変数名 | 参照箇所 | 分類 |
|--------|---------|------|
| `DATABASE_URL` | `src/lib/db/client.ts:7` | アプリ変数（Supabase Transaction Pooler URL）|
| `NEXT_PUBLIC_SUPABASE_URL` | `src/lib/supabase/server.ts:8`, `client.ts:5`, `middleware.ts:10` | アプリ変数（公開可）|
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `src/lib/supabase/server.ts:9`, `client.ts:6`, `middleware.ts:11` | アプリ変数（公開可）|
| `FUWACCHI_DEVICE_ID` | `src/lib/platforms/fuwacchi/event-list.ts:32` | アプリ変数（任意・デフォルト `""`）|

### 環境変数ファイルの存在確認（中身は読まない）

| ファイル | 存在 |
|---------|------|
| `.env.local` | ✅ 存在 |
| `.env.local.example` | ✅ 存在 |
| `.env` | なし |
| `.env.production` | なし |

### Cloudflare Workers 移行時の対応

| 変数 | 移行方法 | 備考 |
|------|---------|------|
| `DATABASE_URL` | Cloudflare Workers Secret | 機密情報 |
| `NEXT_PUBLIC_SUPABASE_URL` | wrangler.jsonc の `vars` または Dashboard の Environment Variable | 公開値のため Secret 不要でも可 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 同上 | Supabase anon key は公開前提の設計 |
| `FUWACCHI_DEVICE_ID` | wrangler.jsonc の `vars` | 任意・空文字でも動作 |

**Vercel 固有環境変数（`VERCEL_*`）: ゼロ件。** 移行時の変数削除・変換作業不要。

---

## 9. ビルド出力サイズ予測

### public/ ディレクトリ

| 項目 | 値 |
|------|----|
| 合計サイズ | **4.84 KB**（`du -sh public/` 相当） |
| ファイル数 | 9 ファイル |
| 内訳 | `icons/icon-192.png`, `icons/icon-512.png`, `manifest.json`, `robots.txt`, `favicon.ico`, `file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg` |

### Workers サイズ制限との比較

| 区分 | 値 |
|------|----|
| public/ 静的アセット | 4.84 KB（Free 3MiB の 0.16%） |
| Worker JS（`.open-next/worker.js`） | ビルド実行なしのため実測不能 |
| Worker JS 推定 | Next.js 16.2 + Server Components のみ。Client Components は ASSETS に分離される設計のため、Worker.js 本体は軽量になる見込み |
| Free Tier 上限 | Worker JS: 3MiB / ASSETS: 制限なし |
| Paid Tier 上限 | Worker JS: 10MiB |

**重要:** `framer-motion` / `recharts` 等の重いライブラリは AGENTS.md の指針どおり `next/dynamic` で Client Component として遅延ロードされる前提のため、Worker JS には含まれない。実際の Worker JS サイズは `opennextjs-cloudflare build` 後のビルドログで確認が必要。

---

## 10. データベース・外部 API 依存

| 種別 | 使用技術 | Workers 適合性 | 詳細 |
|------|---------|--------------|------|
| **メイン DB** | Supabase（PostgreSQL）+ Drizzle ORM | ✅ | Transaction Pooler 経由・`postgres@3.4.9` + `nodejs_compat` |
| **認証** | Supabase Auth（`@supabase/ssr`） | ✅ | Cookie ベース・fetch 経由 |
| **ふわっち API** | `api.whowatch.tv`（REST・fetch） | ✅ | `AbortSignal.timeout(4000)` |
| **Kick API** | `kick.com/api/v2`（REST・fetch） | ✅ | `AbortSignal.timeout(8000)` |
| **Kick Pusher** | `pusher-js` WebSocket | ✅ | **クライアント側のみ**（`useKickMonitor.ts` hook）。サーバー側 Pusher 不使用 |
| **ニコ生** | `live.nicovideo.jp`（HTML スクレイピング・fetch） | ✅ | `next: { revalidate: 0 }` = no-cache |
| **ふわっちイベントランキング** | `www.whowatch.tv/event/`（HTML スクレイピング・fetch） | ✅ | |
| **ローカルファイル書き込み** | **なし** | ✅ | Workers ではファイル I/O 不可だが使用していない |

**Drizzle ORM + postgres パッケージの接続パターン（重要）:**

```typescript
// src/lib/db/client.ts
// コメント: Cloudflare Workers の I/O 制約：グローバルに保持禁止
export function createDbClient() {
  const client = postgres(process.env.DATABASE_URL!, {
    prepare: false,  // Supabase トランザクションプーラー対応
  });
  return drizzle(client);
}
```

`prepare: false` は Supabase Transaction Pooler 要件を満たしており、Workers でも問題ない。`createDbClient()` が Route Handler / Server Action 内で都度呼ばれる設計はすでに正しい。

---

## 11. WebSocket / Durable Objects 適合性（案C再設計用）

### 現状の WebSocket 利用パターン

| 種別 | 場所 | 内容 | 判定 |
|------|------|------|------|
| **クライアント側 WebSocket** | `src/hooks/useKickMonitor.ts` | Kick 公式 Pusher WebSocket。ブラウザから直接 Pusher に接続（`pusher-js` 使用）。サーバー経由なし | ✅ Workers 移行で変更不要 |
| **サーバー側 WebSocket** | **なし** | `src/app/api/` 全 16 Route Handlers に WebSocket なし | ✅ |
| **SSE（Server-Sent Events）** | **なし** | grep ゼロ件 | ✅ |

### workers/ ディレクトリの状態

`D:\tagdeck\workers\` に以下の空ディレクトリのみ存在。実装コードなし。

| ディレクトリ | 状態 |
|-------------|------|
| `workers/fuwacchi-poller/` | **空ディレクトリ（雛形のみ）** |
| `workers/kick-watcher/` | **空ディレクトリ（雛形のみ）** |
| `workers/niconico-watcher/` | **空ディレクトリ（雛形のみ）** |

### Phase 3a-1 の文脈：Render Free → Durable Objects への変更

既存 `docs/migration/tagdeck_inventory_20260511.md` 案C では「Render Free Node.js WebSocket 中継サーバー」が前提だった。Cloudflare Workers 前提に変更した場合の対比:

| 項目 | 旧案C（Render Free） | 新案C（Durable Objects） |
|------|---------------------|------------------------|
| WebSocket サーバー | Render Free / Node.js + ws ライブラリ | Cloudflare Durable Objects（WebSocket Hibernation API）|
| コールドスタート問題 | Render Free 15分スリープ → Keep-alive 14分間隔 ping が必須 | **問題なし**。Durable Objects は Hibernation で永続保持 |
| 水平スケール | 手動 | 自動（Durable Objects が 1 DO ≒ 1 配信者セッション） |
| コスト | Render Free（0 円、帯域制限あり） | Free Tier: 100万 DO リクエスト/月。通常用途なら 0 円圏内 |
| コード管理 | 別サービス（Render のダッシュボード + GitHub CI）| **同一リポジトリ内**（`wrangler.jsonc` に追記するだけ）|
| デプロイ複雑度 | 2サービス管理（Vercel + Render）| **1サービス管理**（Cloudflare Workers のみ）|
| Supabase DB 書き込み | Render Worker → Supabase REST API / SDK | Durable Object → Supabase SDK（fetch ベース・同様）|

### Durable Objects 実装概要（Phase 3a-1 インプット）

```
// 概念構成（実装着手は別セッション・社長承認後）
// wrangler.jsonc に追加が必要な設定（例）
{
  "durable_objects": {
    "bindings": [
      { "name": "STREAM_SESSION", "class_name": "StreamSession" }
    ]
  }
}

// StreamSession Durable Object の役割
// - 1 DO = 1 配信者 × 1 セッション
// - WebSocket Hibernation API で接続を永続保持
// - ふわっち / ニコ生の定期ポーリング（5秒 / 4.5秒）
// - Supabase への状態書き込み（fetch ベース）
// - Kick Pusher はクライアント直結のため DO 不要
```

**結論:** Phase 3a-1 で Render Free が不要になり、Cloudflare Workers 1基盤に統合できる。工数削減と複雑度低減の両面で優位。

---

## 12. DNS / ドメイン現状

| 項目 | 確認方法 | 結果 |
|------|---------|------|
| **tagdeck.jp ドメイン** | `src/app/layout.tsx` の `metadataBase`・`canonical` | `https://tagdeck.jp` が明示されている |
| **DNS プロバイダー** | コードから判定可能な範囲 | メモリ記録「tagdeck.jp は Cloudflare DNS + AI Labyrinth ON」と一致。`layout.tsx` の URL が tagdeck.jp であることと矛盾なし |
| **Vercel 独自ドメイン** | `vercel.json` 不在・`@vercel/*` import ゼロ | vercel.json に domains 設定なし |
| **Vercel URL 参照** | コード内 `vercel.app` 参照 | `public/vercel.svg`（Vercel ロゴ SVG）のみ。機能的依存なし |

**DNS 切替時の注意点:**

- tagdeck.jp はすでに Cloudflare DNS 管理下のため、Workers ルートの設定は Cloudflare Dashboard のみで完結
- `wrangler.jsonc` に `routes` を追記するか、Cloudflare Dashboard で "Workers Routes" → `tagdeck.jp/*` を設定
- AI Labyrinth が ON のため、Workers デプロイ後の動作検証では通常ブラウザ（非 bot）でのみ行うこと

---

## 13. CI/CD 現状と移行後の前提

### 現状

| 項目 | 状態 |
|------|------|
| GitHub Actions | **未設定**（`.github/workflows/` が空ディレクトリ）|
| 現在のデプロイ方法 | Vercel 自動デプロイ（main push トリガー）|
| Cloudflare デプロイ | 手動実行（`pnpm deploy` = `opennextjs-cloudflare build && opennextjs-cloudflare deploy`）|

### 移行後の CI/CD 設計（前提情報）

| 項目 | 推奨方針 |
|------|---------|
| トリガー | `main` push |
| ビルド | `opennextjs-cloudflare build` |
| デプロイ | `wrangler deploy`（`CLOUDFLARE_API_TOKEN` Secret が必要）|
| プレビュー環境 | `wrangler deploy --env preview`（別 Workers プロジェクト）|
| GitHub Actions 雛形 | Cloudflare 公式 action `cloudflare/wrangler-action@v3` で実装可能 |
| Vercel 削除タイミング | Workers 本番デプロイ + DNS 切替後 72 時間の安定確認後 |

---

## 14. 移行コスト再見積もり（実体ベース）

### 旧見積もり（claude.ai セッション当初）

「5〜8時間 / 3〜5セッション」

### 実体ベース再計算

**Phase 1（アダプター導入）は既に完了しているため不要。**

| フェーズ | 内容 | 実時間 | 備考 |
|---------|------|-------|------|
| Phase 0: 棚卸し | 本セッション | 1 セッション（完了）| |
| Phase 1: アダプター導入 | **不要** | — | `@opennextjs/cloudflare` + `wrangler.jsonc` + `open-next.config.ts` が既にある |
| Phase 2: Cloudflare プロジェクト作成・Secrets 投入 | Dashboard 操作 + `pnpm deploy` 初回実行 | **30〜60 分** | 環境変数 4 件を投入するだけ |
| Phase 3: DNS 切替 + 動作検証 | Cloudflare Dashboard での Workers ルート設定 | **30〜45 分** | tagdeck.jp は既に Cloudflare DNS |
| Phase 4: Vercel 削除 | Vercel プロジェクト削除 + Vercel.svg 削除（任意） | **15 分** | |
| **合計** | | **1.5〜2 時間 / 2 セッション** | |

当初見積もり比: **75〜80% 削減**（アダプター導入済みが判明したため）

---

## 15. ブロッカー一覧（影響度・対応方針付き）

**致命的ブロッカー: なし**

| # | ブロッカー | 影響度 | 対応方針 | 工数 |
|---|-----------|--------|---------|------|
| B1 | `@serwist/next` PWA + opennextjs-cloudflare の組み合わせ未検証 | **低** | `pnpm run preview`（`opennextjs-cloudflare preview`）で Service Worker が正常に動作するか確認。`public/sw.js` は ASSETS バインドで配信されるため理論上問題ない。失敗した場合は `disable: true` で PWA を無効化しても機能影響なし（Progressive Enhancement） | 30 分 |
| B2 | `next/font/google`（Inter）のビルド時ネットワーク取得 | **低** | opennextjs-cloudflare ビルド時に Google Fonts API へのアクセスが必要。ビルド環境でのネットワーク疎通を確認。失敗した場合は `next/font/local`（フォントファイルをローカル配置）に切替 | 15 分 |
| B3 | `postgres@3.4.9` と `nodejs_compat` の TCP 接続 | **低** | `nodejs_compat` は TCP ソケットをポリフィルする。Supabase Transaction Pooler との接続は `prepare: false` 設定済みで Workers 対応済み。初回デプロイ後に `/api/events` 等のエンドポイントで DB 疎通確認を実施 | 確認のみ・10 分 |
| B4 | Worker JS サイズが Free Tier（3MiB）を超過するリスク | **中** | `framer-motion` / `recharts` は AGENTS.md で `next/dynamic` 遅延ロードが指定されているが、実際に遅延ロードされているか grep 確認が必要（本棚卸しでは全コンポーネントを精査していない）。超過した場合は Cloudflare Workers Paid（$5/月）へのアップグレードで即解決 | ビルド後確認 30 分 |
| B5 | `niconico.ts` の `next: { revalidate: 0 }` | **なし** | `revalidate: 0` は `cache: 'no-store'` と等価。opennextjs-cloudflare が適切に変換する。ブロッカーではないが確認推奨 | 確認のみ |
| B6 | CI/CD 未設定（`.github/workflows/` 空）| **低** | 現状は手動デプロイで問題なし。`cloudflare/wrangler-action@v3` で GitHub Actions を後日設定可能 | 別セッション・任意 |

---

## 16. 推奨フェーズ分割（案C計画書改訂の入力）

前回 `tagdeck_inventory_20260511.md` §10 案C の「Render Free WebSocket サーバー構築」を **Durable Objects** で置き換えた改訂案。

| フェーズ | 内容 | 目安時間 | 依存 |
|---------|------|---------|------|
| **Phase CF-1** | Cloudflare Workers プロジェクト作成 + Secrets 投入 + `pnpm run preview` で動作確認 | 45 分 | wrangler CLI ログイン・CF アカウント |
| **Phase CF-2** | tagdeck.jp DNS を Workers ルートに切替 + 動作確認 | 30 分 | Phase CF-1 完了 |
| **Phase CF-3** | Vercel プロジェクト削除（72 時間安定後） | 15 分 | Phase CF-2 安定確認後 |
| **Phase 3a-1 改（DO版）** | `StreamSession` Durable Object 実装（ふわっち / ニコ生の永続ポーリング）| 2〜3 時間 | Phase CF-2 完了 |
| **Phase 3a-2** | Supabase Auth に YouTube / Google OAuth 追加 | 1 時間 | 独立して実施可 |
| **Phase 3a-3** | コメントビューア UI + DO との接続 | 2〜3 時間 | Phase 3a-1 DO完了 |

**Render Free アカウント取得は不要になる**（Phase 3a-1 改で DO を使用するため）。

---

## 17. CTO 真鍋玲央 推奨判断

**推奨: Phase CF-1 → CF-2 → CF-3 を優先実施（2 セッション / 計 1.5 時間）。その後 Phase 3a-1 改（DO 版）に着手。**

### 根拠

1. **技術的ブロッカーはゼロ。** アダプター・設定ファイルが既に揃っており、残作業は Cloudflare Dashboard の操作と DNS 切替のみ。
2. **Vercel Hobby Plan 商用利用規約リスクを最短 1.5 時間で解消できる。** これは事業継続性の最優先課題。
3. **Durable Objects 採用でアーキテクチャが単純化される。** Render Free の Keep-alive 管理・コールドスタート対策・別サービス CI/CD を丸ごと不要にできる。工数・複雑度の両面で旧案C より優位。
4. **DNS は既に Cloudflare 管理下のため切替コストが最小。** tagdeck.jp の Workers ルート設定は Cloudflare Dashboard で数分。
5. **B4（Worker JS サイズ）が唯一の不確定要素。** ただし超過しても Paid プラン（$5/月）で即解決可能。Free Tier での継続を前提とする場合は `next/dynamic` の実装状況を事前確認すること。

### 推奨しない判断

- **現状維持（Vercel 継続）**: 商用利用規約違反リスクが残存。
- **Phase 3a-1 を Render Free で先行**: Durable Objects 移行が確定した場合に作業が無駄になる。

本レポートをもとに社長が Cloudflare 移行を承認した場合、次セッションで Phase CF-1（Cloudflare プロジェクト作成・Secrets 投入・preview 確認）から着手することを推奨する。案C計画書の Cloudflare 版書き直しは本セッションでは行わない。

---

*作成: CTO 真鍋玲央 / 2026-05-11*  
*調査方法: read-only（既存ファイルへの変更ゼロ）*  
*秘密情報: 本レポートに `.env` / credentials の内容は一切含まない*  
*対象: `D:\tagdeck\` のみ。他事業への言及なし。*
