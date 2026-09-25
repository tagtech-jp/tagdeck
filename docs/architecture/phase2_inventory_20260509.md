# TagDeck Phase 0.5 棚卸し - ベータ運用フェーズ前提調査 (2026-05-09)

## 0. 棚卸し前提

| 項目 | 内容 |
|---|---|
| 実行日時 | 2026-05-09 |
| 実行者 | CTO 真鍋玲央 (Claude Code) |
| モード | **read-only** — 既存ファイルの変更・削除・リネーム禁止。git commit/push 禁止 |
| 出力物 | 本ファイル 1 件のみ新規作成 |
| 前提スナップショット | `D:\tagdeck\docs\architecture\phase1_snapshot_20260509.md` |
| Phase 2 再定義 | ベータ運用フェーズ (CRM 本格実装は保留・Cloudflare 移行は後回し・課金未実装) |
| 棚卸し対象外 | workers/ / crm/ / shared/ / ai-prompter/ / 課金関連 |

---

## 1. LP (ランディングページ) の現状

### src/app/page.tsx — 存在する (40 行)

**現状の構成**: サーバーコンポーネント。Supabase でログイン状態を確認し、ログイン済みなら「ダッシュボードへ」ボタン、未ログインなら「ログイン」「新規登録」の 2 ボタンを表示する最小スタブ。

**主要テキスト (h1/p)**:
```
h1: TagDeck
p:  配信者向けセカンドスクリーン SaaS
```

**LP 固有コンポーネントの有無**:
- `src/components/marketing/` — **なし**
- `src/components/landing/` — **なし**
- `src/app/(marketing)/` 等の marketing route group — **なし**

**スクリーンショット・デモ動画への参照**: **なし**

**総評**: LP は現状ほぼプレースホルダー。訴求コピー・機能説明・デモ画像・ CTA ボタン群のすべてが未着手。

---

### src/app/layout.tsx — グローバル metadata

```
title:       "TagDeck - 配信者向けセカンドスクリーン"
description: "ふわっち・ニコ生・Kick の配信者向けリアルタイム CRM・AI 接客カンペ"
manifest:    "/manifest.json"
appleWebApp: capable=true / statusBarStyle="black-translucent" / title="TagDeck"
lang:        "ja"
themeColor:  "#0a0a0a"
```

OGP (openGraph) / Twitter Card の `metadata` フィールド設定 — **なし**

---

## 2. SEO 設定の現状

### next.config.ts

SEO 関連の設定なし（`headers()`、`redirects()`、`rewrites()` も未設定）。  
設定内容: serwist (PWA SW) + `reactStrictMode: true` + `images.unoptimized: true`

### 各 page.tsx の metadata export / generateMetadata

| ファイル | metadata export |
|---|---|
| src/app/layout.tsx | **あり** (グローバル title / description のみ) |
| src/app/page.tsx | **なし** |
| src/app/(auth)/layout.tsx | **なし** |
| src/app/(dashboard)/layout.tsx | **なし** |
| src/app/(dashboard)/*/page.tsx | **なし** (全ページ) |

ページ固有の `<title>` / `<meta description>` は全ページでグローバル設定を継承中。

### robots.txt

`public/robots.txt` — **なし**（存在しない）

### sitemap

- `public/sitemap.xml` — **なし**
- `src/app/sitemap.ts` — **なし**

### OGP 画像

- `public/og-image.*` — **なし**
- `public/opengraph-image.*` — **なし**
- `src/app/opengraph-image.*` — **なし**（Next.js App Router 規約ファイルも未作成）

### JSON-LD Structured Data

`application/ld+json` / `json-ld` 等のパターン — **なし**

### public/manifest.json の SEO 関連項目

| フィールド | 値 |
|---|---|
| name | TagDeck |
| short_name | TagDeck |
| description | 配信者向けセカンドスクリーン SaaS |
| theme_color | #0a0a0a |
| background_color | #0a0a0a |
| start_url | / |
| display | standalone |

### 総評

SEO 実装は layout.tsx の title/description のみ。robots.txt・sitemap・OGP 画像・JSON-LD・ページ固有 metadata のすべてが未着手。現状では Google 等の検索エンジンに正しくインデックスされない状態。

---

## 3. フィードバック導線の現状

### src/ 配下 grep 結果

| パターン | ヒット |
|---|---|
| `feedback / contact / inquiry / お問い合わせ` | **0 件** |
| `discord webhook` (フィードバック用) | **0 件** |
| `Tally / Google Forms / Typeform / Notion フォーム` | **0 件** |

### Discord 関連コード

`src/components/auth/OAuthButtons.tsx` に Discord **OAuth ログイン**のプロバイダー設定あり（Google / Twitter / Discord の 3 択）。フィードバック webhook とは別用途。

### 既存のフィードバックリンク

LP にも dashboard にも **フィードバックボタン・フォームへのリンクなし**。

### 総評

フィードバック収集の仕組みは**皆無**。テスターからの意見を受け取る手段が現時点でまったく存在しない。

---

## 4. ベータバナー / 免責 / 利用規約の現状

### バナー・告知コンポーネント

| 調査対象 | 結果 |
|---|---|
| `src/components/ui/alert.tsx` | shadcn Alert コンポーネント（存在するが実際の告知用途での使用なし） |
| バナー専用コンポーネント (Banner / Notice / Announcement) | **なし** |
| LP や dashboard 内にベータ告知テキスト | **なし** |

※ DB schema.ts の `bannerUrl` カラムはイベントのバナー画像 URL であり、サイト全体の告知バナーとは無関係。

### 利用規約・プライバシーポリシー

| パス | 有無 |
|---|---|
| `src/app/terms/` | **なし** |
| `src/app/privacy/` | **なし** |
| `src/app/legal/` | **なし** |
| `src/app/(legal)/` | **なし** |

### 免責事項

LP 内・dashboard 内のいずれにも免責事項テキスト、ベータ版告知、データ利用説明 — **なし**。

### footer コンポーネント

`src/components/` に footer コンポーネント — **なし**。  
dashboard の `src/app/(dashboard)/layout.tsx` は header + Sidebar + main + BottomTabBar の構成で **footer なし**。  
LP (`src/app/page.tsx`) も footer なし。

### 総評

ベータ公開に必要な法的・運用的テキスト（利用規約・プライバシーポリシー・免責・ベータ告知）がすべて未整備。ベータ公開前に最低限の整備が必要。

---

## 5. テスター募集の前提

### サインアップフロー (src/app/(auth)/signup/)

**ファイル構成**:
- `page.tsx` (131 行) — サインアップ UI
- `actions.ts` (44 行) — Server Action (Supabase auth.signUp 呼び出し)

**フロー概要**:
1. 表示名（maxLength=50）/ メールアドレス / パスワード（8 文字以上・大小英数字）/ パスワード確認を入力
2. または Google / Twitter / Discord OAuth でサインアップ
3. Supabase が確認メールを送信（emailRedirectTo → `/auth/confirm`）
4. リンクをクリックして登録完了

**追加フィールド（流入経路アンケート等）**: **なし**

### 招待コード・限定公開機能

| パターン | ヒット |
|---|---|
| `invite / beta-code / waitlist / 招待` | **0 件** |

現状は**オープン登録**（誰でも `URL/signup` からアカウント作成可能）。

### メールマガジン・ニュースレター登録

| パターン | ヒット |
|---|---|
| `newsletter / subscribe / メルマガ` | **0 件**（Supabase Realtime の `.subscribe()` のみヒット、別用途）|

### OAuth プロバイダー

`src/components/auth/OAuthButtons.tsx` で Google / Twitter / Discord の 3 プロバイダーが実装済み。

### 総評

サインアップ自体は動作する状態だが、テスター限定制御（招待コード・ウェイトリスト）も募集告知導線（ニュースレター等）もなし。公開すれば誰でも即登録可能な状態。

---

## 6. CTO 真鍋玲央コメント

### Phase 2 で「触る範囲」「触らない範囲」の確定提案

#### 触る範囲（フルパス）

```
D:\tagdeck\src\app\page.tsx                          # LP 改修
D:\tagdeck\src\app\layout.tsx                        # OGP / metadata 拡充
D:\tagdeck\src\app\(auth)\signup\page.tsx            # ベータ告知テキスト追加（任意）
D:\tagdeck\src\app\(legal)\                          # 新規作成：利用規約・PP ルートグループ
D:\tagdeck\src\app\(legal)\terms\page.tsx            # 新規作成：利用規約
D:\tagdeck\src\app\(legal)\privacy\page.tsx          # 新規作成：プライバシーポリシー
D:\tagdeck\src\components\layout\BetaBanner.tsx      # 新規作成：ベータ告知バナー
D:\tagdeck\src\components\layout\Footer.tsx          # 新規作成：フッター（利用規約/PP リンク）
D:\tagdeck\public\robots.txt                         # 新規作成
D:\tagdeck\src\app\sitemap.ts                        # 新規作成
D:\tagdeck\public\og-image.png                       # 新規作成（OGP 画像）
```

#### 触らない範囲

```
D:\tagdeck\src\app\(dashboard)\          # ダッシュボード機能本体
D:\tagdeck\src\app\(auth)\              # サインアップ・ログイン実装ロジック（変更不要）
D:\tagdeck\src\lib\                      # コアロジック
D:\tagdeck\drizzle\                      # DB マイグレーション
D:\tagdeck\src\app\api\                  # API ルート
D:\tagdeck\workers\                      # 対象外（Phase 1 スナップショット参照）
D:\tagdeck\src\components\crm\          # 対象外（保留）
D:\tagdeck\src\app\(dashboard)\ai-prompter\ # 対象外（保留）
```

---

### 各セクションの判定

| 作業 | 判定 | 根拠 |
|---|---|---|
| ① LP 改修 | **ゼロから作る** | 現状は 40 行の最小スタブ。コピー・機能説明・デモ画像なし |
| ② SEO 設定 | **ゼロから作る** | robots.txt・sitemap・OGP・JSON-LD・ページ別 metadata 全未着手 |
| ③ フィードバック導線 | **ゼロから作る** | 導線・フォーム・webhook のすべてなし |
| ④ ベータバナー / 利用規約 / PP | **ゼロから作る** | バナー・利用規約・PP・footer 全未着手。法的リスクあり |

---

### 不明点・社長への確認事項

1. **利用規約・PP の帰属**: TagDeck 単独のページとして作成するか、TagTech 個人事業全体の共通ページに統合するか？（URL: `tagdeck.app/terms` vs `tagtech.jp/terms`）
2. **フィードバック収集先**: 既存の TagTech Discord サーバー（別プロジェクト）を流用するか、TagDeck 専用 Discord または Tally/Typeform 等の外部フォームを使うか？
3. **テスター制御方針**: オープン登録（現状維持）でよいか、招待コード制・ウェイトリスト制に変更するか？
4. **LP のデザイン方針**: テキスト中心の簡素な改良にとどめるか、デモ動画・スクリーンショット・機能比較表まで作り込むか？（工数が大きく変わる）

---

### 推奨着手順序

**④ → ② → ① → ③**

| 順序 | 作業 | 理由 |
|---|---|---|
| 1st | ④ ベータバナー + 利用規約 + PP | 法的リスクを最初に排除。ベータ告知はユーザー登録前から表示必須 |
| 2nd | ② SEO 設定 | テスター募集 URL を検索エンジンに正しく認識させるため LP 公開前に整備 |
| 3rd | ① LP 改修 | SEO の土台（OGP・sitemap・metadata）を整えてから LP コンテンツを作ると重複なし |
| 4th | ③ フィードバック導線 | ベータ運用開始後に実運用しながら改善できる。他 3 作業より優先度低 |

---

*本ファイルは棚卸し専用スナップショット。実装変更は Phase 2 着手フェーズから行う。*
