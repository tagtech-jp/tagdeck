# Phase 3a-1b キックオフチェックリスト

> 作成日: 2026-05-12
> 目的: 社長手作業(Render / Supabase / YouTube OAuth)を漏れなく実施するためのチェックリスト
> 前提: Phase 3a-1a 完了(workers/ 雛形配置済 / commit c46966d)
> 関連: docs/migration/phase3_plan_v1.0.md §7.1 / docs/retrospectives/2026-05-11_phase3_v1.0_retrospective.md §4.2

---

## 0. 全体所要時間

社長手作業合計: 約 30〜60 分(以下5項目の合計)

---

## 1. T1: Supabase events テーブル定義確認(5〜10分)

### 目的

Phase 3a-2 で `stream_id` / `platform_comment_id` / `moderated` の3カラムを
`ALTER TABLE ADD COLUMN` で追加する際、既存カラムとの競合がないことを事前確認する。

追加予定カラムの仕様(DB設計 v0.2 §1.2 より):

| カラム | 型 | NULL | 用途 |
|---|---|---|---|
| `stream_id` | text | NOT NULL(段階移行・§10 参照) | ニコ生 thread_id 相当・他 PF は配信回識別子 |
| `platform_comment_id` | text | NULL 許容 | ふわっちのみ NULL・他 PF は冪等性キー |
| `moderated` | boolean | NOT NULL DEFAULT false | Phase 3a-4 で Llama Guard 結果格納 |

### 手順

- [ ] Supabase Dashboard にログイン
  - URL: https://supabase.com/dashboard
- [ ] 対象プロジェクト(TagDeck)を選択
- [ ] 左メニュー → Table Editor → `events` テーブルを開く
- [ ] 現状のカラム定義(カラム名・型・NULL制約・デフォルト値)を確認
- [ ] または SQL Editor で以下クエリを実行:

```sql
-- events テーブルのカラム定義を取得
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'events'
ORDER BY ordinal_position;
```

### 判定基準

- [ ] `stream_id` カラムが存在しない(または存在する場合は型と NULL 制約を記録)
- [ ] `platform_comment_id` カラムが存在しない(同上)
- [ ] `moderated` カラムが存在しない(同上)
- [ ] 全カラム定義を下記メモ欄に記録

### 結果メモ(社長記入欄)

```
記入日時:
events テーブル現状カラム数: ___
追加予定3カラムの既存衝突: あり / なし
備考:
```

---

## 2. T2: Supabase events RLS ポリシー確認(5〜10分)

### 目的

Phase 3a-2 で新カラム追加後、既存 INSERT/SELECT/UPDATE ポリシーが
`NEW.stream_id` 参照等でクラッシュしないか事前確認する。
(retrospective §4.2 T2 対応)

### 手順

- [ ] Supabase Dashboard → Authentication → Policies
- [ ] `events` テーブルのポリシー一覧を確認
- [ ] または SQL Editor で以下クエリを実行:

```sql
-- events テーブルの RLS ポリシー取得
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'events';
```

### 判定基準

- [ ] RLS が有効か無効か記録
- [ ] 各ポリシーの cmd(INSERT/SELECT/UPDATE/DELETE)・qual・with_check を記録
- [ ] 新カラム(`stream_id` / `platform_comment_id` / `moderated`)を参照しているポリシーがないこと

### 結果メモ(社長記入欄)

```
記入日時:
RLS 状態: 有効 / 無効
ポリシー数: ___
新カラム参照ポリシー: あり / なし
備考:
```

---

## 3. Render Free アカウント作成(5〜10分)

### 目的

Phase 3a-1b で `workers/fuwacchi-poller/` の Node.js (ws) WebSocket 中継サーバーを
デプロイする実行環境を確保する。(計画書 §7.1 より: 案D-Hybrid v3 採用・Render Free)

### 公式ドキュメント

- Render 公式トップ: https://render.com
- 無料プラン説明: https://render.com/docs/free
- Node.js Web Service デプロイ: https://render.com/docs/web-services

### 手順

- [ ] https://render.com にアクセス・サインアップ(または既存アカウントでログイン)
- [ ] 無料プラン Free Tier を選択
- [ ] GitHub 連携(tagdeck リポジトリ参照のため)
- [ ] アカウント情報(メール・パスワード)を社長個人記録に保存
  ※このチェックリストには値を書かない

### Render Free 仕様メモ(計画書 §7.1 より)

| 項目 | 仕様 |
|---|---|
| コールドスタート通常 | 500ms 未満(Keep-alive ping 稼働中) |
| コールドスタート最悪 | 約1分(強制再起動後) |
| Keep-alive 対策 | 14分間隔 ping を fuwacchi-poller に実装予定 |
| 月無料枠 | 750時間 |

### 結果メモ(社長記入欄)

```
作成日時:
Render アカウント email: (個人記録参照・本書非記載)
GitHub 連携: 済 / 未
備考:
```

---

## 4. YouTube/Google OAuth アプリ設定(15〜30分)

### 目的

Phase 3a-1b の `workers/youtube-relay/` が YouTube Live Chat API にアクセスするために
必要な OAuth クライアントを Google Cloud Console で作成し、
Supabase Auth に Google プロバイダーを追加する。(計画書 §7.1 より)

### 公式ドキュメント

- Google Cloud Console: https://console.cloud.google.com
- OAuth 2.0 設定ガイド: https://developers.google.com/identity/protocols/oauth2
- YouTube Data API v3 有効化: https://developers.google.com/youtube/v3/getting-started
- Supabase Auth Google プロバイダー: https://supabase.com/docs/guides/auth/social-login/auth-google

### 手順

- [ ] Google Cloud Console でプロジェクト作成(または既存利用)
- [ ] YouTube Data API v3 を有効化
- [ ] OAuth 2.0 クライアント ID を作成
  - タイプ: **ウェブ アプリケーション**
- [ ] 承認済みリダイレクト URI に Supabase Auth Callback URL を追加
  - 形式: `https://<your-project-ref>.supabase.co/auth/v1/callback`
  - ※実値は Supabase Dashboard → Settings → API で確認(本書非記載)
- [ ] スコープ設定:
  - `openid`
  - `email`
  - `profile`
  - `https://www.googleapis.com/auth/youtube.readonly`(YouTube Live Chat 読み取り用)
- [ ] Client ID と Client Secret を取得・社長個人の機密保管に保存
  ※このチェックリストには絶対に記載しない
- [ ] Supabase Dashboard → Authentication → Providers → Google を有効化
- [ ] 上記 Client ID と Client Secret を Supabase に入力

### 結果メモ(社長記入欄)

```
作成日時:
Google Cloud プロジェクト ID: (個人記録参照・本書非記載)
OAuth Client ID: (社長機密保管・本書非記載)
Supabase Google プロバイダー: 有効 / 無効
リダイレクト URI 設定: 済 / 未
備考:
```

---

## 5. Render 環境変数投入(5分)

### 目的

Render Web Service が Supabase に接続するための環境変数を Render Dashboard に登録する。
(計画書 §7.1: Render Worker ↔ Supabase DB の INSERT 疎通テスト前に必須)

### 必要環境変数(キー名のみ・値は非記載)

- [ ] `SUPABASE_URL` — Supabase プロジェクト URL
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — Supabase Service Role Key
  ※機密・絶対に GitHub に push しない。Supabase Dashboard → Settings → API で取得
- [ ] `NODE_ENV` — `production`
- [ ] `KEEP_ALIVE_INTERVAL_MS` — `840000`(14分・Render Free コールドスタート対策)

### 手順

- [ ] Render Dashboard → 対象 Web Service → **Environment** タブ
- [ ] 上記4変数を1件ずつ追加
- [ ] 値は Supabase Dashboard → Settings → API から取得
- [ ] 保存後に Web Service を再デプロイ

### 結果メモ(社長記入欄)

```
設定日時:
4変数すべて設定: 済 / 未
再デプロイ: 済 / 未
備考:
```

---

## 6. 全項目チェック完了確認

- [ ] Section 1 (T1: events テーブル定義) 完了
- [ ] Section 2 (T2: events RLS ポリシー) 完了
- [ ] Section 3 (Render Free アカウント) 完了
- [ ] Section 4 (YouTube/Google OAuth) 完了
- [ ] Section 5 (Render 環境変数) 完了
- [ ] 全結果メモ記入済み
- [ ] Phase 3a-1b 実装着手の前提条件が整った

---

## 7. 次フェーズへの引き継ぎ

Phase 3a-1b 着手時の最初の確認事項:

1. T1 結果メモ: ALTER TABLE 衝突がないこと
2. T2 結果メモ: 新カラムを参照するポリシーが存在しないこと
3. Render アカウント: GitHub 連携が有効
4. Supabase Google プロバイダー: 有効
5. Render 環境変数: 4件すべて設定済み

上記5点が確認できたら Phase 3a-1b 実装着手可能。

---

## 関連ドキュメント

| ドキュメント | パス |
|---|---|
| 計画書(Phase 3 全体) | `docs/migration/phase3_plan_v1.0.md` |
| retrospective (§4.2 T1/T2) | `docs/retrospectives/2026-05-11_phase3_v1.0_retrospective.md` |
| DB 設計(v0.2) | `docs/migration/phase3_db_design_v0.md` |
| Phase 3a-1a 完了 commit | `c46966d` |

---

*作成: 2026-05-12 / TagTech 個人事業 AIエージェントチーム / 累計事故ゼロ 69 達成セッションにて作成*
