# TagDeck Phase 2 計画書 v1.0 - ベータ運用フェーズ (2026-05-09)

---

## 1. 計画書メタ情報

| 項目 | 内容 |
|---|---|
| バージョン | v1.0 |
| 起案日 | 2026-05-09 |
| 起案者 | CTO 真鍋玲央 |
| レビュー予定者 | 社長 (最終承認) |
| ステータス | **社長承認待ち** |

### 関連ドキュメント

| ドキュメント | パス |
|---|---|
| Phase 1 スナップショット | `D:\tagdeck\docs\architecture\phase1_snapshot_20260509.md` |
| Phase 0.5 棚卸し | `D:\tagdeck\docs\architecture\phase2_inventory_20260509.md` |
| ふわっち API 仕様 | `D:\tagdeck\docs\architecture\fuwacchi_api_endpoints_v1.md` |
| Phase 5b 設計書 | `D:\tagdeck\docs\architecture\phase5b-bayesian-design.md` |
| Phase 5c 設計書 | `D:\tagdeck\docs\architecture\phase5c-event-tracker-design.md` |

---

## 2. 目的・背景

### 方針転換の経緯

Phase 2 当初は「CRM 本格実装（案 A）」が候補に挙がっていたが、社長との議論の結果、**ベータ運用フェーズ**として再定義した。理由はコア機能（3 プラットフォーム監視 + イベント勝率計算）がすでに Phase 5c-beta まで完成しており、実際のベータユーザーを獲得してフィードバックを得ることがサブスク化準備の最短経路と判断されたため。

### ベータ運用フェーズの意義

1. **実ユーザー検証**: 仮説ベースの開発から実データ駆動の改善サイクルへ移行する
2. **フィードバック収集**: 社長の配信コメント経由で課題を収集し、次フェーズのスコープを決める
3. **サブスク化準備**: 法務整備（利用規約・PP）・SEO・LP を整えて「いつでも課金開始できる」状態にする
4. **ゼロコスト維持**: Vercel 無料枠 + Supabase 無料枠で運用を継続する

### スコープアウト項目

以下は Phase 2 に含まない（将来フェーズで検討）:

| 項目 | 理由 |
|---|---|
| 案 A: CRM 本格実装 | 実ユーザーの声を聞いてからスコープを決める |
| AI-Prompter 実装 | `src/app/(dashboard)/ai-prompter/` は Phase 3 以降に持ち越し |
| Cloudflare Workers 移行 | Vercel で安定稼働中のため後回し |
| 課金システム実装 | Stripe 等の連携は後フェーズ |
| フィードバックフォーム | 配信コメントで代替。実装コストゼロを優先 |

---

## 3. 完了定義 (Definition of Done)

Phase 2 は以下をすべて満たしたとき完了とする:

- [ ] 作業 ④: ベータバナー・利用規約・PP が Vercel 本番で表示される
- [ ] 作業 ②: SEO 設定（robots.txt / sitemap / OGP / JSON-LD / metadata）が本番で動作する
- [ ] 作業 ①: LP が刷新され、スクリーンショット 2-3 枚が配置されている
- [ ] `pnpm test` (vitest) が全件 PASS のまま維持されている
- [ ] Vercel preview デプロイ URL で全画面（LP / ログイン / サインアップ / ダッシュボード）の表示を目視確認済み
- [ ] ベータ告知テキスト・配信案内が LP に掲載されている
- [ ] 利用規約・プライバシーポリシーへのリンクが LP と signup ページの両方に存在する

---

## 4. 確定事項 (9 項目)

社長との議論で確定済み。**再判断不要**。

| 項目 | 確定内容 |
|---|---|
| 本番ホスティング | Vercel 維持 (Cloudflare 移行は後回し) |
| Phase 2 メイン | ベータ運用フェーズ (案 A: CRM 本格実装は保留) |
| 利用規約・PP 帰属 | TagTech 共通 (tagtech.jp/terms にリンク or 共通テンプレ流用) |
| テスター制御 | オープン登録 (現状維持・招待コード不要) |
| LP デザイン方針 | テキスト改良 + スクリーンショット 2-3 枚 (動画・比較表は不要) |
| フィードバック収集 | 配信コメントで代替 (実装ゼロ・LP に配信案内明記) |
| 着手順序 | ④ バナー+法務 → ② SEO → ① LP |
| 課金システム | 未実装 (対象外) |
| Phase 2 で触らない範囲 | workers/, src/components/crm/, src/components/shared/, src/app/(dashboard)/ai-prompter/, src/app/(dashboard)/crm/ |

---

## 5. 触る範囲

Phase 0.5 棚卸しレポートの調査結果に基づく。全 10 ファイル。

| # | フルパス | 区分 | 対応作業 |
|---|---|---|---|
| 1 | `D:\tagdeck\src\app\page.tsx` | 改修 | ① LP |
| 2 | `D:\tagdeck\src\app\layout.tsx` | 改修 | ② SEO |
| 3 | `D:\tagdeck\src\app\(auth)\signup\page.tsx` | 改修 | ④ 法務リンク追加 |
| 4 | `D:\tagdeck\src\app\(legal)\terms\page.tsx` | **新規** | ④ 利用規約 |
| 5 | `D:\tagdeck\src\app\(legal)\privacy\page.tsx` | **新規** | ④ PP |
| 6 | `D:\tagdeck\src\components\layout\BetaBanner.tsx` | **新規** | ④ バナー |
| 7 | `D:\tagdeck\src\components\layout\Footer.tsx` | **新規** | ④ フッター |
| 8 | `D:\tagdeck\public\robots.txt` | **新規** | ② SEO |
| 9 | `D:\tagdeck\src\app\sitemap.ts` | **新規** | ② SEO |
| 10 | `D:\tagdeck\public\og-image.png` | **新規** | ② SEO |

**補足**: `src/app/(legal)/layout.tsx` は (legal) ルートグループのレイアウトとして追加が必要になる可能性がある。実装フェーズで要確認。

---

## 6. 触らない範囲

以下は Phase 2 で一切変更しない。

| フルパス | 理由 |
|---|---|
| `D:\tagdeck\src\app\(dashboard)\` | ダッシュボード機能本体・Phase 1-5c 実装済み |
| `D:\tagdeck\src\app\(auth)\login\` | ログイン実装は変更不要 |
| `D:\tagdeck\src\app\(auth)\reset-password\` | パスワードリセット実装は変更不要 |
| `D:\tagdeck\src\app\api\` | API ルート全体 |
| `D:\tagdeck\src\lib\` | コアロジック全体 |
| `D:\tagdeck\drizzle\` | DB マイグレーション (スキーマ変更なし) |
| `D:\tagdeck\package.json` | 依存関係変更なし |
| `D:\tagdeck\.env*` | 機密ファイル (開かない) |
| `D:\tagdeck\.git\` | git 操作禁止 |
| `D:\tagdeck\node_modules\` | 変更禁止 |
| `D:\tagdeck\workers\` | Phase 2 スコープ外 |
| `D:\tagdeck\src\components\crm\` | 保留 |
| `D:\tagdeck\src\components\shared\` | 保留 |
| `D:\tagdeck\src\app\(dashboard)\ai-prompter\` | 保留 |
| `D:\tagdeck\src\app\(dashboard)\crm\` | 保留 |
| `D:\tagdeck\scripts\` | Python 同期スクリプト群 (変更なし) |

---

## 7. 作業詳細

### 7.1 作業 ④: ベータバナー + 利用規約 + プライバシーポリシー

**優先度**: 最高（法的リスク排除のため Phase 2 の最初に実施）

#### 触るファイル

| ファイル | 改修内容 |
|---|---|
| `src/app/(legal)/terms/page.tsx` | **新規**: 利用規約ページ。TagTech 共通テンプレを流用または tagtech.jp/terms へのリダイレクト/リンク |
| `src/app/(legal)/privacy/page.tsx` | **新規**: プライバシーポリシーページ。個人情報の取扱い・Supabase 利用・ログ保持期間を明記 |
| `src/components/layout/BetaBanner.tsx` | **新規**: 全ページ上部に表示するベータ告知バナーコンポーネント |
| `src/components/layout/Footer.tsx` | **新規**: 利用規約・PP リンク・配信案内を含むフッターコンポーネント |
| `src/app/layout.tsx` | **改修**: BetaBanner と Footer を body に組み込む |
| `src/app/(auth)/signup/page.tsx` | **改修**: 利用規約・PP への同意文言と リンクを追加 (「登録することで [利用規約] [プライバシーポリシー] に同意します」) |

#### ベータバナーの要件

```
表示内容 (必須):
- "Beta 版無料テスト中 — 予告なく有料化する可能性があります"
- "データが消失するリスクがあります (免責)"
- "フィードバックは [配信名・URL] のコメント欄へ ※社長確認後に URL を確定"
表示位置: ページ上部スティッキー または root layout の最上段
デザイン: 既存の sonner トースト / shadcn alert コンポーネントを流用可
```

#### 利用規約・PP の要件

```
利用規約:
- TagTech 共通テンプレを使用 (社長確認事項: テキストの在処)
- 最低限の記載: サービス概要・免責事項・禁止事項・変更の告知方法
- URL: /terms

プライバシーポリシー:
- Supabase への個人情報保存・認証メール送信について明記
- ログデータの保持期間・第三者提供なし について明記
- URL: /privacy
```

#### 成功基準

- [ ] `/terms` と `/privacy` が 200 OK で表示される
- [ ] BetaBanner が LP・dashboard・signup の全ページで表示される
- [ ] signup ページに利用規約・PP への同意テキストとリンクが存在する
- [ ] フッターに `/terms`・`/privacy` へのリンクが存在する
- [ ] `pnpm test` 全件 PASS

#### STOP 条件

- 利用規約・PP の法的文面を Claude Code が独断で起草しようとしたとき → 社長に確認を仰ぐ
- (legal) ルートに認証ガードを追加しようとしたとき → 公開ページのため不要
- ベータバナーの色・デザインで時間を使いそうになったとき → 最小限の実装で OK

#### 概算工数

2〜3 時間（法務テキストの準備が完了している前提）

---

### 7.2 作業 ②: SEO 最適化

**優先度**: 高（テスター募集 URL をインデックスさせるため LP 公開前に整備）

#### 触るファイル

| ファイル | 改修内容 |
|---|---|
| `src/app/layout.tsx` | **改修**: `metadata` に `openGraph` / `twitter` / `alternates.canonical` を追加 |
| `public/robots.txt` | **新規**: Googlebot 許可・admin 系 URL を disallow |
| `src/app/sitemap.ts` | **新規**: Next.js App Router の sitemap.ts 規約に沿って `/` / `/terms` / `/privacy` を列挙 |
| `public/og-image.png` | **新規**: 1200×630px の OGP 画像 (デザインは別途準備・プレースホルダーで先行可) |

#### layout.tsx metadata の拡充内容

```typescript
// 追加予定フィールド (値は社長確認後に確定)
openGraph: {
  title: "TagDeck - 配信者向けセカンドスクリーン",
  description: "ふわっち・ニコ生・Kick の配信者向けリアルタイム CRM・AI 接客カンペ",
  url: "https://tagdeck.app",          // ← 実際のドメインに合わせる
  siteName: "TagDeck",
  images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  locale: "ja_JP",
  type: "website",
},
twitter: {
  card: "summary_large_image",
  title: "TagDeck - 配信者向けセカンドスクリーン",
  description: "...",
  images: ["/og-image.png"],
},
```

#### JSON-LD Structured Data

`src/app/layout.tsx` または `src/app/page.tsx` に `<script type="application/ld+json">` を追加:

```json
{
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "name": "TagDeck",
  "description": "配信者向けセカンドスクリーン SaaS",
  "applicationCategory": "Utility",
  "operatingSystem": "Web"
}
```

#### robots.txt の内容 (案)

```
User-agent: *
Allow: /
Disallow: /dashboard
Disallow: /crm
Disallow: /events
Disallow: /settings
Sitemap: https://tagdeck.app/sitemap.xml
```

#### 成功基準

- [ ] `https://tagdeck.app/robots.txt` が 200 OK で返る
- [ ] `https://tagdeck.app/sitemap.xml` が 200 OK で返る
- [ ] OGP タグが `<head>` に存在する (Twitter Card Validator 等で確認)
- [ ] JSON-LD が `<script type="application/ld+json">` として存在する
- [ ] `pnpm test` 全件 PASS

#### STOP 条件

- next.config.ts に headers() / rewrites() を大幅追加しようとしたとき → 最小限にとどめる
- ページ別に generateMetadata を全ページに展開しようとしたとき → 今回はグローバル設定のみで十分
- tagdeck.app 以外のドメインを想定しようとしたとき → 社長にドメインを確認してから記入

#### 概算工数

1〜2 時間（OGP 画像のデザインは別途）

---

### 7.3 作業 ①: LP 刷新 (src/app/page.tsx)

**優先度**: 中（SEO の土台が整ってから実施する）

#### 触るファイル

| ファイル | 改修内容 |
|---|---|
| `src/app/page.tsx` | **改修**: 全面書き直し。ベータ訴求文・機能見出し・スクリーンショット・CTA・配信案内・法務リンクを追加 |

#### LP の必須要素

```
セクション 1: ヒーロー
  - h1: キャッチコピー (社長確認事項)
  - サブコピー: "ふわっち・ニコ生・Kick の配信者向けセカンドスクリーン"
  - CTA: [新規登録（無料）] [ログイン]
  - ベータ表記: "現在ベータ版 — 無料でご利用いただけます"

セクション 2: 主要機能 3 点 (見出しのみ・詳細説明は不要)
  - リアルタイムリスナー監視（ふわっち / ニコ生 / Kick 対応）
  - イベント勝率計算（モンテカルロ + ベイズ推定）
  - ランキングシミュレーション

セクション 3: スクリーンショット (2-3 枚・社長準備)
  - ダッシュボード画面
  - イベント勝率画面（任意）
  - プラットフォーム設定画面（任意）

セクション 4: フィードバック案内 (実装ゼロ・テキストのみ)
  - "フィードバックは [配信名・URL] のコメント欄へ" (社長確認事項)

セクション 5: フッター
  - [利用規約] [プライバシーポリシー] リンク (Footer コンポーネント)
```

#### 技術方針

- サーバーコンポーネント維持（Supabase auth.getUser() でのログイン状態判別は継続）
- 画像は `next/image` コンポーネントを使用（`public/screenshots/` 以下に配置）
- スクリーンショット画像は `alt` 属性必須（アクセシビリティ）
- スクリーンショットが未準備の場合はプレースホルダー（グレー背景 + テキスト）で先行可

#### 成功基準

- [ ] LP が `/` で表示され、h1・サブコピー・CTA の全要素が存在する
- [ ] スクリーンショットが 2-3 枚以上配置されている（またはプレースホルダー）
- [ ] [新規登録] → `/signup` へ遷移する
- [ ] [利用規約] リンク → `/terms` へ遷移する
- [ ] [プライバシーポリシー] リンク → `/privacy` へ遷移する
- [ ] ベータ告知テキストが表示されている
- [ ] 配信案内テキスト（URL 含む）が表示されている
- [ ] `pnpm test` 全件 PASS
- [ ] モバイル画面 (375px) でのレイアウト崩れなし

#### STOP 条件

- LP にアニメーション・framer-motion を多用しようとしたとき → シンプルなテキスト + 画像で十分
- CTA ボタンを 5 個以上作ろうとしたとき → 最大 2 個（新規登録 / ログイン）に限定
- A/B テスト機能を追加しようとしたとき → 対象外

#### 概算工数

2〜3 時間（スクリーンショット準備込み）

---

## 8. 成功基準 (作業横断)

Phase 2 全体の品質基準:

| 基準 | 確認方法 |
|---|---|
| `pnpm test` 全件 PASS | CI / ローカル実行 |
| Vercel preview URL で LP 表示 | ブラウザ目視 |
| Vercel preview URL でダッシュボード表示 | ブラウザ目視 |
| `/terms` / `/privacy` が 200 OK | ブラウザ目視 |
| OGP タグが存在する | ブラウザ DevTools `<head>` 確認 |
| `robots.txt` が 200 OK | ブラウザ直アクセス |
| `sitemap.xml` が 200 OK | ブラウザ直アクセス |
| BetaBanner が全ページで表示 | LP / ログイン / ダッシュボードで目視 |
| 法務リンクが LP・signup 両方に存在 | ブラウザ目視 |
| モバイル 375px でレイアウト崩れなし | DevTools レスポンシブモード |

---

## 9. STOP 条件 (実装フェーズ共通)

以下のいずれかが発生した場合、**即停止して社長に報告**する:

| 条件 | 対応 |
|---|---|
| `.env*` / `credentials.json` / `token.json` を誤って開いた | 即停止・社長報告 |
| 触らない範囲（workers/ / crm/ / shared/ / api/ / lib/ 等）への変更衝動が生じた | 即停止・計画書を見直す |
| 確定事項 9 項目以外の機能追加衝動が生じた | 即停止・社長に確認 |
| `pnpm test` が FAIL した | 修正が確実でなければ即停止・社長報告 |
| Karpathy 原則違反（独断・波及修正・過剰設計）を自覚した | 即停止・社長に方針確認 |
| drizzle migration を追加したくなった | Phase 2 はスキーマ変更ゼロのため即停止 |
| BetaBanner の display 条件（A/B テスト・特定ユーザー除外等）を実装したくなった | 即停止・シンプルな全表示のみ |

---

## 10. リスク登録

| ID | リスク | 影響 | 対応 |
|---|---|---|---|
| R1 | TagTech 共通利用規約・PP のテキストが未準備 | 作業 ④ の着手が遅れる | 着手前に社長が本文を確認・提供する（確認事項 #1） |
| R2 | 配信プラットフォーム URL が未確定 | BetaBanner・LP の配信案内が仮テキストのまま | 社長が URL を確定する（確認事項 #2）。プレースホルダーで先行着手は可 |
| R3 | スクリーンショット画像が未準備 | 作業 ① で LP にプレースホルダー配置が必要になる | プレースホルダーで先行・後から差し替え。工数への影響小 |
| R4 | og-image.png のデザイン未定 | SEO 作業が一部不完全なまま進む | 1200×630px のシンプルなテキスト + 黒背景で先行。後から差し替え可 |
| R5 | SEO のターゲットキーワードが未確定 | description / JSON-LD の文言が最適化できない | 社長確認後に metadata を更新（確認事項 #3）。先行着手は可 |
| R6 | tagdeck.app ドメインが Vercel の本番 URL と異なる | OGP の url / sitemap の Sitemap URL が誤る | 実際のドメインを社長に確認してから SEO 作業を完了する |

---

## 11. 不明点・社長への確認事項 (Phase 2 着手前に確定が必要)

1. **利用規約・PP の本文**: TagTech 共通テンプレのテキストはどこにある？ 新規起草するか、既存の文書を流用するか？（R1 の解消に必要。作業 ④ の着手ブロッカー）

2. **配信プラットフォーム URL**: LP と BetaBanner に記載する「フィードバック先の配信」はふわっち / YouTube / ニコ生 / Kick のどれ（または複数）で、URL は何か？（R2 の解消に必要）

3. **SEO ターゲットキーワード**: 狙いたい検索キーワードの候補はあるか？（例: 「ふわっち イベント支援」「配信者 リスナー管理」「ニコ生 CRM」）

4. **og-image.png のデザイン方針**: シンプルなテキスト（黒背景 + ロゴ文字）で先行して OK か、それともデザイン確認を待つか？

5. **スクリーンショット**: 撮影済みの画像はあるか？ なければ Vercel 本番画面 / ローカル開発画面どちらで撮影するか？

6. **LP のキャッチコピー**: h1 に置くキャッチコピーの候補を社長の言葉で 1〜3 案もらえると助かる。（現状の「配信者向けセカンドスクリーン SaaS」のままにするか変更するか？）

---

## 12. git commit 単位 (実装フェーズ参考)

実装時は `feature/phase2-beta` ブランチを切り、main への merge は社長承認後に行う。

| 作業 | コミットメッセージ (案) | タイミング |
|---|---|---|
| ④ 完了 | `feat(beta): add beta banner, terms, privacy, footer, signup legal links` | 作業 ④ が全成功基準を満たした時点 |
| ② 完了 | `feat(seo): add metadata OGP, sitemap, robots.txt, JSON-LD` | 作業 ② が全成功基準を満たした時点 |
| ① 完了 | `feat(lp): redesign landing page with hero, features, screenshots, cta` | 作業 ① が全成功基準を満たした時点 |
| Phase 2 完了 | (main へ merge PR) | 全作業完了 + 社長承認後 |

**ブランチ戦略**:
- `feature/phase2-beta` を main から切って全作業をここで行う
- 各作業完了時に commit (上記 3 回)
- 全作業完了後に Vercel preview URL で社長確認 → main へ merge → Vercel 本番反映

---

## 13. 改訂履歴

| 版 | 日付 | 変更内容 | 承認者 |
|---|---|---|---|
| v1.0 | 2026-05-09 | 初版起案 | CTO 真鍋玲央 (社長承認待ち) |

---

*本ドキュメントは計画書のみ。コード実装は社長承認後に `feature/phase2-beta` ブランチで開始する。*
