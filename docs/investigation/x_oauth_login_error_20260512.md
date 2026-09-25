# X (Twitter) OAuth ログインエラー調査レポート

**作成者**: Claude Code (read-only 調査)  
**作成日**: 2026-05-12  
**対象エラー**: 「このページのリクエスト・トークンが無効です。使用済み、または期限切れの可能性があります」  
**調査方法**: read-only（コード・設定ファイルの参照のみ。.env / 環境変数の値は一切読まない）

---

## 結論（最有力原因）

### 第1位: Supabase の Twitter Auth 設定と X Developer Portal の Callback URL 不一致

X に登録すべき Callback URL は **Supabase のコールバック URL** である。  
`https://<project-ref>.supabase.co/auth/v1/callback`  
Supabase が Twitter の OAuth エンドポイントへリクエストトークンを取得しに行く際、この URL を提示する。X Developer Portal にこの URL が登録されていない・または別の URL が登録されている場合、**X がトークンを無効として返す**。

### 第2位: DNS 切替後（Vercel → Cloudflare Workers）による Supabase Auth URL 設定の陳腐化

`tagdeck.jp` の DNS は 2026-05-12 に Vercel から Cloudflare Workers へ切替済み（`phase_cf2_verification_20260512.md` で確認）。  
Supabase Dashboard の **Site URL / Redirect URLs** が旧 Vercel URL（例: `tagdeck-xxx.vercel.app`）のままの場合、OAuth 後のリダイレクトが失敗しうる。

---

## 原因候補一覧

| 優先度 | # | 原因候補 | 根拠 |
|--------|---|---------|------|
| **高** | 1 | X Developer Portal の Callback URL が Supabase コールバック URL と不一致 | OAuth 1.0a でリクエストトークン生成時に X が callback URL を検証する。不一致時はトークン無効エラーが発生する |
| **高** | 2 | Supabase Auth の Twitter API Key / API Key Secret が失効・削除・再生成されている | Supabase → Auth → Providers → Twitter に登録した Consumer Key/Secret が正しくない場合、X への認証リクエスト自体が通らない |
| **高** | 3 | Supabase Dashboard の Site URL または Redirect URLs に `https://tagdeck.jp` が含まれていない | DNS 切替後は `window.location.origin` が `https://tagdeck.jp` になる。`redirectTo` がこの URL を送るが、Supabase が許可リスト外として拒否する可能性がある |
| **中** | 4 | X Developer Portal のアプリが OAuth 1.0a のみ対応で、Supabase が OAuth 2.0 PKCE を要求している（またはその逆） | コールバックルートが `code` パラメータ（PKCE/OAuth 2.0 フロー）を期待している。X Developer Portal の OAuth 設定が "OAuth 1.0a Only" になっている場合は不整合が生じる |
| **中** | 5 | リクエストトークンの期限切れ（ユーザー操作の遅延） | OAuth 1.0a のリクエストトークンは約 5 分で失効する。ページを開いたまま放置してから認証ボタンを押すと期限切れになる（再現性が低く断続的なエラー） |
| **低** | 6 | Supabase プロジェクトの Auth が Twitter Provider として有効化されていない | Supabase Dashboard → Auth → Providers → Twitter が Disabled のままの場合、エラーが起きる |
| **低** | 7 | Vercel と Cloudflare Workers の二重デプロイによる Cookie / Session の競合 | Cloudflare Workers (`tagdeck.bb25xp.workers.dev`) と Vercel がどちらも稼働中。Cookie ドメインスコープの不整合でセッションが汚染される可能性（低い） |

---

## 各候補の確認手順（社長が手元で踏める手順）

### 候補 1: X Developer Portal Callback URL 確認

1. [https://developer.x.com/en/portal/projects-and-apps](https://developer.x.com/en/portal/projects-and-apps) を開く
2. TagDeck 用のアプリを選択 → **Settings** タブ
3. **"User authentication settings"** → **Callback URI / Redirect URL** を確認する
4. 登録されているべき URL は以下の形式:
   ```
   https://<あなたのsupabaseプロジェクトref>.supabase.co/auth/v1/callback
   ```
5. Supabase Project URL は Supabase Dashboard → Settings → API → **Project URL** で確認できる
6. 上記 URL が X Developer Portal に **正確に** 登録されているか確認する（末尾スラッシュの有無も要確認）

---

### 候補 2: Supabase Twitter OAuth 認証情報の確認

1. [https://supabase.com/dashboard/project/＜あなたのprojectref＞/auth/providers](https://supabase.com/dashboard) を開く
2. **Authentication** → **Providers** → **Twitter** を選択
3. **Enabled** がオンになっているか確認
4. **API key** (Consumer Key) と **API key secret** (Consumer Key Secret) が入力されているか確認
5. X Developer Portal のアプリの **Keys and Tokens** ページで表示される値と一致しているか照合する
   - 特に「Regenerate」を過去にクリックしたことがある場合、Supabase 側が古い値のまま残っていることがある

---

### 候補 3: Supabase Auth URL 設定の確認（DNS 切替後の対応）

1. Supabase Dashboard → **Authentication** → **URL Configuration** を開く
2. **Site URL** を確認する
   - 正しい値: `https://tagdeck.jp`
   - 旧 Vercel URL（例: `https://tagdeck-xxx.vercel.app`）になっていないか確認
3. **Redirect URLs** の欄に以下がすべて含まれているか確認する:
   ```
   https://tagdeck.jp/auth/callback
   https://tagdeck.bb25xp.workers.dev/auth/callback   ← Workers サブドメインも追加推奨
   ```
4. 不足している URL があれば追加する

---

### 候補 4: X Developer Portal の OAuth バージョン設定確認

1. X Developer Portal → アプリ Settings → **User authentication settings**
2. **OAuth 2.0** の欄を確認する:
   - **OAuth 2.0** が **Enabled** になっているか確認
   - **Type of App**: `Web App, Automated App or Bot` を選択しているか
   - **Callback URI / Redirect URL**: 上記候補 1 の確認と同じ
3. **OAuth 1.0a** の欄も確認:
   - Supabase が OAuth 1.0a を使う場合は、こちらの **Callback URL** も同様に設定が必要

---

### 候補 5: 期限切れの再現確認（断続的エラーの場合）

1. ログインページを開く
2. 「X でログイン」ボタンをクリックした直後に X の認証画面が出た場合、5 分以内に「認証」を押す
3. 5 分以上経過してから押すとこのエラーが再現するか確認する
4. 毎回エラーが出る場合は候補 1〜3 が原因。時々だけエラーが出る場合は候補 5 が原因

---

### 候補 6: Twitter Provider の有効化確認（基本チェック）

1. Supabase Dashboard → Authentication → Providers → Twitter の **Enabled** トグルがオンか確認

---

## 推奨対処（実装は本タスクでは行わない）

### 最優先（必ず確認・修正すべき）

1. **候補 1 の修正**: X Developer Portal の Callback URL に `https://<project-ref>.supabase.co/auth/v1/callback` を追加/修正する
2. **候補 3 の修正**: Supabase Dashboard → URL Configuration の Site URL を `https://tagdeck.jp` に更新し、Redirect URLs に `https://tagdeck.jp/auth/callback` を追加する

### 次点

3. **候補 2 の確認**: Twitter API Key/Secret が最新のものか確認する（過去に再生成していれば Supabase 側も更新）
4. **候補 4 の確認**: OAuth 2.0 が有効化されているか確認する

---

## 調査範囲外として保留したもの

| 項目 | 保留理由 |
|------|---------|
| Supabase Dashboard の実際の設定値 | read-only 制約。ブラウザで社長が直接確認する必要がある |
| X Developer Portal の実際の Callback URL | 同上。社長が直接確認する必要がある |
| `.env.local` の `NEXT_PUBLIC_SUPABASE_URL` 値 | .env 内容読み取り禁止 |
| Vercel の環境変数設定 | 環境変数の値取得禁止 |
| Supabase Auth ログ（実際のエラーログ） | Supabase Dashboard → Logs → Auth Logs で確認可能（調査外） |

---

## コード上の観察事項（異常ではないが参考情報）

| 観察 | 内容 |
|------|------|
| `redirectTo` の動的生成 | `window.location.origin` を使用。本番(tagdeck.jp)・Workers サブドメイン・ローカル(localhost:3000) で URL が変わる。Supabase の Redirect URLs 許可リストにすべて登録する必要がある |
| コールバックルートの実装 | PKCE フロー (`code` パラメータ) を使用 → OAuth 2.0 と推定される |
| ミドルウェア | `/auth/` パスを `isAuthCallback` として保護除外済み（問題なし） |
| Cookie 書き込みの try-catch | Server Component からの呼び出し時のエラーを無視する実装（Supabase 公式パターン通り、問題なし） |
| DNS 切替完了済み | 2026-05-12 に tagdeck.jp が Vercel → Cloudflare Workers へ切替完了。この切替後に OAuth エラーが初めて発生したのであれば、候補 3（Supabase Site URL の陳腐化）がほぼ確実に原因の一つ |

---

*調査実施: 2026-05-12*  
*調査範囲: D:\tagdeck\src\ 配下の OAuth/Auth 関連ファイル、package.json、next.config.ts、既存設計書*  
*`.env` / 環境変数の値は一切読んでいない*
