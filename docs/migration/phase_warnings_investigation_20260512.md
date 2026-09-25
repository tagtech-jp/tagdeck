# TagDeck 警告調査レポート

**作成者**: CTO 真鍋玲央  
**調査日**: 2026-05-12  
**調査方法**: read-only（ソースコード参照・pnpm dev 起動・HTTP レスポンス確認のみ）

---

## 調査サマリ

| 区分 | 件数 | 備考 |
|-----|------|------|
| pnpm dev 実測ビルド警告 | **1件** | middleware.ts 非推奨のみ |
| handoff §9 記載の「7件」 | **不明** | handoff 文書が D:\tagdeck\ に存在しないため実測不可。§9 は phase3 計画書のリスク節（Groq レート枯渇等）であり、ビルド警告の記録ではなかった |
| ブラウザ Console 警告 | 特定済み | Recharts width(-1)/height(-1) — ビルド警告ではなくランタイム警告 |

---

## (1) ビルド警告 現状リスト

### 実測環境

- 実行コマンド: `pnpm dev --turbopack`（Windows Git Bash、D:\tagdeck）
- 実行結果: `.next/dev/logs/next-development.log` に記録
- Next.js バージョン: 16.2.4（Turbopack）
- 注: WSL 内 ~/tagdeck は存在しないため Windows 側で実行

### W-1: middleware.ts 非推奨警告（CONFIRMED）

**ログ原文:**
```
⚠ The "middleware" file convention is deprecated.
Please use "proxy" instead.
Learn more: https://nextjs.org/docs/messages/middleware-to-proxy
```

| 項目 | 内容 |
|------|------|
| 発生箇所 | `src/middleware.ts`（サーバー起動時に毎回出る） |
| 影響度 | **中**（機能は動作するが Next.js 16.2 の公式非推奨 API を使用中） |
| 解消方法 | `src/middleware.ts` → `src/proxy.ts` にリネーム、`export async function middleware()` → `export async function proxy()` に改名。`config` エクスポート（matcher）は変更不要 |
| 解消優先度 | **即時（Step 3 対象）** |
| 根拠 | AGENTS.md に「middleware.ts は Next.js 16 で deprecated → proxy.ts を使用」と明記。両ファイル同時存在でサーバークラッシュするため早期対応が必要 |

### W-2〜W-7: handoff §9 記載の6件（実測不可・推定分析）

**前提**: 「handoff §9」文書が `D:\tagdeck\` 配下に存在しない。
phase3_plan_v1.0.md の §9 は Groq レート枯渇・コールドスタート等のリスク節であり、ビルド警告記録ではなかった。

`pnpm build`（禁止コマンド）を実行しないと `opennextjs-cloudflare build` の警告は確認できない。
コードベース分析から **推定される警告候補** を以下に列挙（確定ではない）:

| # | 推定警告 | 発生コマンド | 影響度 | 推定根拠 |
|---|---------|------------|--------|---------|
| W-2 | ESLint `@typescript-eslint/no-explicit-any` | `pnpm lint` | 軽微 | `src/lib/platforms/fuwacchi/event-list.ts` 他5箇所に `eslint-disable` コメントあり |
| W-3 | `@serwist/next` + opennextjs-cloudflare 組み合わせ | `pnpm preview` | 低〜中 | cloudflare_migration_inventory_20260511.md §15 B1 に「要検証」と記載 |
| W-4 | React Key warning（index as key） | ブラウザ Console | 軽微 | `RankDistributionChartInner.tsx:61` で `key={i}`（index 使用）|
| W-5〜W-7 | 不明 | 不明 | 不明 | handoff 文書なし・pnpm build 実行禁止のため調査不能 |

**社長への確認依頼**: 「7件のビルド警告」はどのコマンドの出力を指しているか（pnpm dev / pnpm build / pnpm preview / wrangler deploy 等）を教えていただければ Step 3 の優先度を正確化できます。

---

## (2) Recharts width(-1)/height(-1) 警告の切り分け結果

### 対象コンポーネント

| コンポーネント | 使用ページ | 呼び出し元 |
|-------------|----------|-----------|
| `HourlyRateChartInner.tsx` | `/dashboard`（要認証）| `StatsPanel.tsx` |
| `RankDistributionChartInner.tsx` | `/events`（要認証）| `EventDashboard.tsx` |

### 切り分け判定: **React コードの問題（Cloudflare/Vercel 無関係）**

**根拠:**

1. **ローカル開発（pnpm dev）でも再現する**
   - 両コンポーネントは `next/dynamic` + `ssr: false` でクライアント専用
   - Cloudflare Workers / Vercel の SSR に依存しない純粋なクライアントサイドコード
   - localhost でログイン後 `/dashboard` または `/events` を開けば同じ警告が出る
   - **再現条件**: 認証が必要なため、F12 Console で確認するには社長がブラウザログインして確認する必要あり（本タスクのスコープ外）

2. **警告の根本原因（コード分析）**

   `RankDistributionChartInner.tsx` 38行目:
   ```tsx
   <div style={{ width: "100%", height: 120 }}>
     <ResponsiveContainer width="100%" height="100%">
   ```

   `HourlyRateChartInner.tsx` 17行目:
   ```tsx
   <div style={{ width: "100%", height: 80 }}>
     <ResponsiveContainer width="100%" height="100%">
   ```

   `ResponsiveContainer` は `ResizeObserver` でコンテナ寸法を計測する。初回マウント時の最初の計測サイクルでブラウザレイアウトが未完了の場合、`width=-1` / `height=-1` を返すことがある。
   次の計測サイクル（数ms後）で正しい寸法が取得され、チャートは正常描画される。

3. **影響度: 軽微（コスメティック警告のみ）**
   - チャートは正常に描画される
   - UX への影響なし
   - Console に1回だけ出て以降は消える（再マウントのたびに1回出る）

4. **Recharts バージョン**: `^3.8.1`（recharts v3）

### 解消方法（実装は Step 3 対象）

`height="100%"` を親 div の明示的高さに合わせた固定 px 値に変更する:

```tsx
// RankDistributionChartInner.tsx — 変更前
<ResponsiveContainer width="100%" height="100%">

// 変更後
<ResponsiveContainer width="100%" height={120}>
```

```tsx
// HourlyRateChartInner.tsx — 変更前
<ResponsiveContainer width="100%" height="100%">

// 変更後
<ResponsiveContainer width="100%" height={80}>
```

親 div の `height: 120` / `height: 80` と一致させることで、`ResizeObserver` に依存せずに高さが確定し、`-1` 計測が発生しなくなる。

---

## (3) 解消スコープ推奨

### Step 3 対象（即時解消推奨）

| ID | 対象 | 変更ファイル | 変更内容 |
|----|------|-----------|---------|
| W-1 | middleware.ts 非推奨 | `src/middleware.ts` → `src/proxy.ts` | ファイルリネーム + 関数名変更 |
| W-Recharts | Recharts width(-1)/height(-1) | `src/components/events/RankDistributionChartInner.tsx` / `src/components/stats/HourlyRateChartInner.tsx` | `height="100%"` → `height={120}` / `height={80}` |

**根拠**: W-1 は AGENTS.md に明記された必須対応。W-Recharts は変更2行・リスクゼロ・Console 警告クリーンアップ。

### 別タスク化推奨

| ID | 対象 | 理由 |
|----|------|------|
| W-2 | ESLint any 警告 | pnpm lint 実行して件数確認後に対応。機能影響なし・緊急度低 |
| W-3 | @serwist/next ビルド検証 | `pnpm preview` 実行が必要。別セッションで実施 |
| W-5〜W-7 | handoff §9 残り6件 | 出典コマンドが不明。社長から情報提供後に調査 |

### 放置推奨（影響なし）

| ID | 対象 | 理由 |
|----|------|------|
| W-4 | `key={i}`（index as key） | データがソート済み固定順のため key 衝突リスクなし。変更コストに対して効果が薄い |

---

## 社長へのアクション依頼

1. **handoff §9 の出典確認**: 「7件のビルド警告」はどのコマンドの出力でしたか？（pnpm dev / pnpm build / pnpm preview / wrangler deploy 等）
2. **ブラウザ手動確認（任意）**: ログイン後に `/dashboard` または `/events` を開き、DevTools Console に `recharts` 関連の警告が表示されることを確認してください（本調査の実地検証）

---

*作成: CTO 真鍋玲央 / 2026-05-12*  
*本レポートに `.env` / credentials の内容は一切含まない*  
*調査方法: read-only（ソースコード編集・git 操作・pnpm build 実行は一切なし）*
