# 退会（アカウント削除）の仕組みと運用（2026-10-08）

> 経緯: セキュリティ監査（`docs/security/tagdeck_security_audit_20261008.md` §3-5・§3-7）で、(1) プライバシーポリシーの記載と実態の差、
> (2) 利用者が自分のアカウントとデータを消す導線が無いこと、が指摘された。本書は (2) の実装と運用。(1) は `src/app/(legal)/privacy/page.tsx`。

## 1. 方式（2 案のうち案 A を採用）

| 案 | 仕組み | 長所 | 短所 |
|---|---|---|---|
| **A（採用）** | DB に `SECURITY DEFINER` の関数 `public.delete_own_account()` を置き（`drizzle/0026`）、API ルートが**本人のログイン**で `supabase.rpc()` を呼ぶ。関数は `auth.uid()` の行だけを消す | Worker に新しい秘密を置かない（監査の「Service Role Key を Worker に置いていない」を保つ）。消す範囲が SQL 1 本に閉じて読める。誰が呼んでも自分の行しか消せない | 社長が SQL Editor で関数を適用するまで機能しない（未適用のときは 503「準備中」） |
| B | 社長が Worker に `SUPABASE_SERVICE_ROLE_KEY` の Secret を追加し、ルートが `auth.admin.deleteUser(id)` を呼ぶ | migration が要らない | **全権限の鍵が Worker に載る**（漏れれば全利用者の全データに届く）。`public.users` 以下は `auth.users` に外部キーが無いので自動では消えず、結局ルート側で表ごとに DELETE が要る |

案 B に切り替える場合の差分は小さい（`route.ts` の (2) を `createClient(url, SERVICE_ROLE_KEY).auth.admin.deleteUser(user.id)` と
Drizzle（`DATABASE_URL`）での表ごとの DELETE に置き換える）。関数の `owner_can_delete_auth` が false だった場合の退路として残す。

## 2. 流れ

1. 画面: 設定 → プロファイル → 「アカウントを削除する」→ 確認欄に「削除」と入力 → 「削除を実行する」（`src/components/settings/DeleteAccountSection.tsx`）
2. `POST /api/account/delete`（`src/app/api/account/delete/route.ts`）。本文 `{ "confirm": "削除" }` が無ければ 400
   - 別サイトからの POST は middleware の Origin ガードが 403（PR #100）。本人確認はログイン Cookie か `Authorization: Bearer`（スマホアプリ）
3. (1) Storage: バケット `se` の `{user_id}/…` を本人の権限で一覧し（1,000 件ずつ）、`remove`。失敗したら 502 で止める（DB は消さない）
   - SQL で `storage.objects` を消すとファイル実体が S3 に残るため、Storage API で消す。(2) の後では本人の権限が無くなるので先に行う
4. (2) DB: `supabase.rpc("delete_own_account")`。1 トランザクションで下表の順に消え、最後に `auth.users` が消える
   - 関数が無い（PGRST202 / 42883）→ 503 `{ reason: "function_missing" }`。画面には「退会の機能はまだ準備中です」
   - それ以外の失敗 → 500 `{ reason: <SQLSTATE> }`。トランザクションなので途中までの削除は残らない
5. (3) `supabase.auth.signOut({ scope: "local" })` でログイン Cookie を消す（Supabase 側のセッションは `auth.users` と一緒に消えている）
6. 画面はトップ（`/`）へ `location.replace`。以後の要求は `getUser()` が Supabase に確かめて失敗するので、どの端末でもログアウト扱いになる

## 3. 消える表（順番どおり）と、外部キーの実際

`public.users` は `auth.users` への外部キーを**持たない**（`drizzle/0000`）。利用者の表の外部キーは `ON DELETE no action` が大半なので、
「`auth.users` を消せば連鎖で消える」は成り立たない。関数は子から順に明示的に消す。

| # | 表 | 絞り込み | 外部キー（適用済み SQL） | 消し方 |
|---|---|---|---|---|
| 1 | `events` | `streamer_id` → 本人の `streamer_profiles` | `streamer_id` → streamer_profiles **no action**、`listener_id` → listeners **no action** | 明示 DELETE |
| 2 | `listeners` | `streamer_id` → 本人の `streamer_profiles` | `streamer_id` → streamer_profiles **no action** | 明示 DELETE |
| 3 | `youtube_oauth_tokens` | `user_id` | → users **cascade**、→ streamer_profiles **cascade** | 明示 DELETE（連鎖でも消えるが件数を数える） |
| 4 | `streamer_profiles` | `user_id` | → users **no action** | 明示 DELETE |
| 5 | `ranking_snapshots` | `simulator_id` → 本人の `event_simulators` | → event_simulators **cascade** | 明示 DELETE（同上） |
| 6 | `event_simulators` | `user_id`（`status='deleted'` の論理削除済みも含む） | → users **no action** | 明示 DELETE |
| 7 | `event_history` | `user_id` | → users **no action** | 明示 DELETE |
| 8 | `se_mappings` | `user_id` | → users **cascade** | 明示 DELETE（同上） |
| 9 | `se_presets` | `owner_user_id` | → users **cascade** | 明示 DELETE（同上） |
| 10 | `users` | `id = auth.uid()` | （auth.users への外部キー無し） | 明示 DELETE |
| 11 | `auth.users` | `id = auth.uid()` | Supabase 側: `auth.identities` / `auth.sessions` / `auth.refresh_tokens` / `auth.mfa_factors` 等が **cascade** | 明示 DELETE → Supabase の外部キーで連鎖 |
| — | Storage `se/{user_id}/…` | 本人のフォルダ | （ポリシー `se: own read` / `se: own delete`） | API ルートが Storage API で削除（関数の外） |

関数の戻り値は表ごとの削除件数（`{ events, listeners, …, users, auth_users }`）で、ルートがログに 1 行出す（`[account/delete] 退会 user=… storage=N {…}`）。

### 消えないもの（仕様）

- 全利用者共有のマスタ: `item_point_mapping`・`event_item_points`・`whowatch_events`・`whowatch_item_patterns` / `_groups` / `_prices` / `_decorations`。利用者の行を持たない
- `event_item_points` に利用者が書いた値は、誰が書いたかの記録が無い（監査 §3-4）ので特定できず残る
- Cloudflare / Supabase 側のログとバックアップ（それぞれの保持期間で消える）。プライバシーポリシーには「バックアップからも一定期間が経過した後に消去」と書いた

## 4. 適用手順（社長・Supabase SQL Editor）

`docs/migration-runbook.md` のとおり。要点:

1. **適用前**: `SELECT count(*) FROM auth.users;` と `SELECT count(*) FROM public.users;` を控える（関数の作成は行を変えないので、同じ値のままのはず）
2. **適用**: `drizzle/0026_delete_own_account_manual.sql` の全文を貼って Run（`BEGIN … COMMIT` 付き）
3. **確認**: 同ファイル末尾の SELECT が 1 行返り、`owner = postgres`・`secdef = true`・`auth_exec = true`・`anon_exec = false`・`owner_can_delete_auth = true`
   - `owner_can_delete_auth` が **false** なら、関数は実行時に権限エラー（42501）になる。回避策を試さず結果を報告し、案 B を検討する
4. **コード**: 本 PR は**適用の前にマージしても壊れない**（未適用なら 503「準備中」を返すだけ）。適用 → 確認 → マージの順でも、マージ → 適用の順でもよい
5. **動作確認**: 本番にしか DB が無いので、`docs/migration-runbook.md` §5 のとおり Admin API でテスト用の利用者（`tagdeck-*-qa@example.com`）を作り、
   その利用者でログイン → 設定 → プロファイル → 削除。トップへ戻り、再ログインできないこと、`auth.users` / `public.users` から id が消えていることを確かめる。
   本物の利用者では試さない

## 5. ロールバック

`drizzle/0026_delete_own_account_rollback.sql`（関数を落とすだけ）。消したデータは戻らない（復元は Supabase のバックアップから）。
コードは PR を revert。関数だけ落とした状態では、ルートは 503「準備中」を返す。

## 6. 既知の制約

- **statement timeout**: PostgREST 経由の呼び出しは `authenticated` 役割の `statement_timeout`（Supabase の既定 8 秒）の中で終わる必要がある。
  `events` に `streamer_id` のインデックスが無いので、`events` 全体が大きいと (1) の DELETE が遅い。超えたら 500 `{ reason: "57014" }` で何も消えない。
  その場合は社長が `docs/migration-runbook.md` §5 の順で手動で消す（または `events(streamer_id)` のインデックス追加を別 PR で）
- **listeners の重複行**: `listeners` に UNIQUE が無く、同じ視聴者の行が 2 つできうる（既知）。どちらも `streamer_id` で消えるので退会には影響しない
- **削除中の配信**: 監視中に退会すると、応答後に動く `waitUntil` の保存（`live/poll`）が外部キー違反で失敗しログに残る。実害は無い
- **スマホアプリ**: `Authorization: Bearer` でも同じルートが使える。200 を受け取ったらアプリ側で保存しているトークンを捨てること（サーバは Cookie しか消せない）
- **Google Play のアカウント削除要件**: アプリ内の導線（設定 → プロファイル）と、Web の削除用 URL `https://tagdeck.jp/settings`（ログイン後）を Play Console の「データの安全性」に記載する

## 7. 関連

- 関数: `drizzle/0026_delete_own_account.sql`（本文）・`_manual.sql`（貼付用・確認 SQL 付き）・`_rollback.sql`
- ルート: `src/app/api/account/delete/route.ts`・テスト `route.test.ts`
- 純粋な部品: `src/lib/account/delete-account.ts`（確認の語・Storage の一覧のページ送り・未適用の判定）・テスト
- 画面: `src/components/settings/DeleteAccountSection.tsx`・`src/app/(dashboard)/settings/page.tsx`
- 方針: `src/app/(legal)/privacy/page.tsx` 第 4 項・第 5 項
- 手動で消す順: `docs/migration-runbook.md` §5
