# DB マイグレーション運用手順（Supabase SQL Editor 手動適用）

> 前提: `deploy.yml` はビルド／Cloudflare Workers デプロイのみで、`drizzle-kit migrate` を実行しない。
> 本番 DB への適用は **社長が Supabase SQL Editor で手動実行**する（0004 以降の実績）。
> 本書は 2026-09-09 の `0009_users_auth_sync` 適用実績をもとに作成。

## 1. 過去の適用経緯（調査結果 2026-09-09）

| 範囲 | 適用方法 | 根拠 |
|---|---|---|
| 0000〜0003 | `drizzle-kit migrate` | `drizzle.__drizzle_migrations` に id 1〜4 が記録（journal の when と一致） |
| 0004〜0008 | SQL Editor 手動 | 管理テーブルに記録なし・スキーマには反映済み・`docs/ops/*_migration_*.md` に貼付手順 |
| 0009 | SQL Editor 手動 | 本書 §3 |

`drizzle/meta/_journal.json` には手動適用分も idx を追記する（`drizzle-kit generate` の連番維持のため）。
`__drizzle_migrations` には手動適用分は記録されないので、**`db:migrate` を本番に対して実行しないこと**（0004 以降を再実行しようとする）。

## 2. ファイルの作り方

1. `src/lib/db/schema.ts` を更新
2. `drizzle/NNNN_<name>.sql` を作成（drizzle-kit 管理用。文は `--> statement-breakpoint` で区切る）
3. トランザクションが必要な場合は **貼付用 `drizzle/NNNN_<name>_manual.sql`** を別に用意する
   - drizzle-kit は breakpoint 単位で実行するため、`BEGIN;/COMMIT;` は breakpoint を跨げない
   - 本文は元ファイルと同一にし、`diff` で一致を確認する
4. `drizzle/NNNN_<name>_rollback.sql` を用意する
5. `drizzle/meta/_journal.json` に `idx` / `when`(epoch ms) / `tag` を追記
6. 冪等（`IF EXISTS` / `IF NOT EXISTS` / `CREATE OR REPLACE` / `ON CONFLICT`）にする

## 3. 適用手順（0009 実績）

### 3-1. 適用前
1. 対象テーブルの行数・制約・インデックスを read-only で記録する
   ```sql
   SELECT count(*) FROM public.users;
   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.users'::regclass;
   SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'users';
   ```
2. 復元用バックアップを `docs/backup/<table>_before_NNNN.sql`（INSERT … ON CONFLICT DO UPDATE 形式）で作成
   - **実データ（メール等）を含むためコミット禁止**。`docs/backup/` は `.gitignore` 済み
3. Supabase Dashboard → Database → Backups で直近の自動バックアップを確認

### 3-2. 適用
1. Supabase Dashboard → 対象プロジェクト → SQL Editor → New query
2. `drizzle/NNNN_<name>_manual.sql` の全文を貼り付けて Run（トランザクション付きなので途中失敗時は何も残らない）
3. `auth` スキーマへのトリガー作成等で権限エラー（`must be owner of relation users` など）が出た場合は、
   回避策を試さずエラー全文を記録して停止する

### 3-3. 適用後の確認（0009 の例）
```sql
-- email が NULL 許容か
SELECT is_nullable FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'email';   -- YES
-- 部分一意インデックス
SELECT indexdef FROM pg_indexes WHERE tablename = 'users' AND indexname = 'users_email_unique';
--   … WHERE (email IS NOT NULL)
-- トリガー
SELECT tgname, tgenabled FROM pg_trigger
 WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal;                      -- on_auth_user_created / O
-- 不一致 0
SELECT count(*) FROM auth.users a
 WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = a.id);               -- 0
```
既存行が変わっていないことを 3-1 の記録（件数・created_at/updated_at）と突合する。

### 3-4. コード側
DB 適用 → 確認 → PR マージ（自動デプロイ）の順。列 rename 等の非互換変更はメンテ時間帯に短時間で両方を切り替える。

## 4. ロールバック手順

1. `drizzle/NNNN_<name>_rollback.sql` を SQL Editor で実行
2. 0009 の場合の注意
   - トリガー／関数の DROP はいつでも安全（サインアップは継続する）
   - `email` の NOT NULL / UNIQUE 復元は、NULL や重複の行があると失敗する。事前に
     `SELECT count(*) FROM public.users WHERE email IS NULL;` と重複確認を行い、社長判断で行を処置してから実行
   - バックフィルで作られた行は削除しない（他テーブルから参照され得る）
3. データ復元が必要なら `docs/backup/<table>_before_NNNN.sql` を実行
4. コードは該当 PR を revert してデプロイ

## 5. 本番でテストする際のデータ後始末

本番 Supabase 以外に検証環境が無いため、テストは本番で行う。**必ず以下を守る。**

1. テストユーザーは Admin API（`auth.admin.createUser`）で作成し、**作成した id を必ず記録**する
   - メール: `tagdeck-*-qa@example.com` のような明らかなテスト名にする
   - email NULL ケースは phone-only ユーザー（`phone` + `phone_confirm: true`）で再現できる
2. ブラウザ自動操作（Playwright）で OAuth ボタンのあるページを触らない
   - 2026-09-09 に Google OAuth へ自動遷移し `tagdeck.jp/?code=…` まで到達した事故あり（ログインは未成立）
   - API テストは supabase-js の `signInWithPassword` でセッションを取得し、
     `sb-<project-ref>-auth-token=base64-<base64url(JSON session)>` Cookie を付けて curl/fetch で叩く
3. 削除順（FK 順）: `event_history` → `event_simulators` → `youtube_oauth_tokens` → `listeners`/`events`（streamer_profiles 経由）→ `streamer_profiles` → `public.users` → `auth.admin.deleteUser`
4. 削除後に確認して報告する
   - 対象 id の残存 0
   - `auth.users` / `public.users` の総数が作業前に戻っている
   - `auth.users` − `public.users` の不一致 0
   - テスト用メールの残存 0

## 6. 参考
- 0009 の設計背景: `drizzle/0009_users_auth_sync.sql` 冒頭コメントと `src/lib/db/ensure-user.ts`（DB トリガー + アプリ側の両建て）
- 過去の手順書: `docs/ops/whowatch_db_migration_20260718.md`, `docs/ops/whowatch_event_title_migration_20260719.md`
