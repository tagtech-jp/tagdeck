# Phase CF-2 Runbook — tagdeck.jp DNS 切替手順書

**作成者**: CTO 真鍋玲央  
**作成日**: 2026-05-12  
**対象読者**: 社長（実施者）  
**前提**: Phase CF-1 完了済み（Workers デプロイ・Secrets 投入済み）

---

## 事前調査結果サマリ（Step 1〜3）

| 項目 | 結果 |
|------|------|
| NS レコード | jaziel.ns.cloudflare.com / clara.ns.cloudflare.com |
| A レコード | 216.198.79.1 / 64.29.17.1（現在 Vercel を指している）|
| AAAA レコード | なし |
| CNAME | なし（apex ドメインのため正常）|
| レジストラ | XSERVER Inc.（エックスサーバー株式会社）|
| DNS 管理 | Cloudflare（NS 委任済み）|
| 現在のバックエンド | Vercel（Server: Vercel / X-Vercel-Id 確認済み）|
| Workers 稼働状況 | 正常（CF-RAY / x-opennext: 1 / HTTP 200 確認済み）|
| **DNS 切替パターン** | **パターン2（外部レジストラ + Cloudflare DNS 委任済み）** |

---

## DNS 切替パターン別手順

### パターン2（該当 — 詳細手順）

**条件**: レジストラ = 外部（XSERVER Inc.）、NS = Cloudflare 委任済み

**必要な作業**: Cloudflare Dashboard のみ。XSERVER / wrangler / Vercel への操作不要。

#### 手順

**Step 1: Cloudflare Dashboard にログイン**

1. ブラウザで `https://dash.cloudflare.com` を開く
2. アカウントにログイン

**Step 2: Workers Custom Domain を追加**

1. 左サイドバー → **Workers & Pages** をクリック
2. `tagdeck` Worker を選択
3. 上部タブ → **Settings** を選択
4. **Domains & Routes** セクションを探す
5. **+ Add** → **Custom Domain** を選択
6. テキストフィールドに `tagdeck.jp` と入力
7. **Add Custom Domain** ボタンをクリック

> **内部動作**: Cloudflare が自動的に以下を実行する
> - 既存の A レコード（Vercel IP）を Workers を指すレコードに書き換え
> - Cloudflare proxy（オレンジ雲）を ON にする
> - SSL/TLS 証明書を発行する（Universal SSL）

**Step 3: SSL 証明書発行待ち**

- 発行にかかる時間: **通常 5〜15 分**
- 証明書発行中は `tagdeck.jp` に HTTPS でアクセスすると「証明書エラー」が表示される場合がある
- Dashboard の Domains & Routes で `tagdeck.jp` の状態が **Active** になれば完了

**Step 4: 動作確認**

証明書が Active になったら `phase_cf2_verify.sh` を実行する。

```bash
bash /d/tagdeck/docs/migration/phase_cf2_verify.sh post
```

---

### パターン1（非該当 — 参考）

**条件**: レジストラ = Cloudflare Registrar

パターン2と同じ操作。ただし DNS レコードの書き換えがより確実に即時反映される。今回は非該当。

---

### パターン3（非該当 — 参考）

**条件**: NS が Cloudflare 以外（お名前.com DNS 等）

この場合は CNAME flattening（CNAME on apex）のためにまず XSERVER で NS を Cloudflare に変更する必要がある。今回は非該当（NS がすでに Cloudflare）。

---

## SSL 証明書発行待ちの目安

| フェーズ | 所要時間 |
|---------|---------|
| Custom Domain 追加ボタン押下 | 即時 |
| Cloudflare が DNS レコード更新 | 1〜2 分 |
| SSL 証明書発行（Universal SSL）| 5〜15 分 |
| グローバル DNS 伝播（TTL=300 秒）| 最大 5 分 |
| **合計（通常）** | **10〜20 分** |

証明書発行中に HTTPS アクセスすると一時的に証明書エラーになる。HTTP（80 番）は引き続き動作する。

---

## 切替後の動作確認チェックリスト

### 自動確認（スクリプト）

```bash
# WSL または Git Bash で実行
bash /d/tagdeck/docs/migration/phase_cf2_verify.sh post
```

スクリプトが確認する項目:
- DNS A レコードが Workers を指しているか
- `CF-RAY` ヘッダーが存在するか（Cloudflare 経由）
- `X-Vercel-Id` ヘッダーが消えているか（Vercel 非経由）
- HTTP → HTTPS リダイレクトが機能するか
- SSL 証明書の発行者が Cloudflare か

### 手動確認（ブラウザ）

```
[ ] https://tagdeck.jp がアドレスバーの錠前アイコン付きで表示される
[ ] ログイン画面 → ログイン操作が成功する（Supabase Auth 疎通）
[ ] イベント一覧が表示される（Supabase DB 疎通）
[ ] ふわっちイベントランキングが表示される
[ ] Kick モニターが動作する
[ ] ニコ生データが取得される
[ ] ブラウザの DevTools Console に重大エラーなし（赤エラー）
[ ] PWA インストールプロンプトが出る（Service Worker 動作確認）
```

---

## ロールバック手順（Vercel に戻す場合）

**条件**: Workers 切替後に重大な不具合が発生し、Vercel に戻す必要が生じた場合

**所要時間**: 5〜10 分

### 手順

1. Cloudflare Dashboard → Workers → `tagdeck` → Settings → Domains & Routes
2. `tagdeck.jp` の横にある **削除（Remove）** ボタンをクリック
3. Cloudflare Dashboard → アカウントホーム → `tagdeck.jp` ゾーン → DNS
4. A レコードを以下の値に手動で戻す:
   ```
   Type: A    Name: @    Value: 216.198.79.1    TTL: Auto    Proxy: DNS only (グレー雲)
   Type: A    Name: @    Value: 64.29.17.1      TTL: Auto    Proxy: DNS only (グレー雲)
   ```
5. Vercel Dashboard で tagdeck.jp がカスタムドメインとして設定されていることを確認
6. 5〜10 分待って DNS 伝播後、`https://tagdeck.jp` が Vercel に戻ることを確認

> **注意**: ロールバック後は `phase_cf2_verify.sh baseline` を再実行して Vercel 経由であることを確認すること。

---

## 72h 安定確認後の Vercel 削除（注記のみ）

切替後 72 時間に渡りエラーゼロを確認後、以下を別タスクとして実施する:

- Vercel Dashboard → tagdeck プロジェクト → Settings → Delete Project
- Cloudflare Workers の古い A レコード（Vercel IP）が残っている場合は削除

**本タスク（Phase CF-2）ではこの操作は実施しない。社長が安定確認後に判断すること。**

---

## 関連ファイル

| ファイル | 役割 |
|---------|------|
| `D:\tagdeck\docs\migration\phase_cf2_preflight_20260512.md` | 現状調査データ（本 runbook の根拠）|
| `D:\tagdeck\docs\migration\phase_cf2_verify.sh` | 切替前後の自動検証スクリプト |
| `D:\tagdeck\docs\migration\cloudflare_migration_inventory_20260511.md` | Workers 移行棚卸し（Phase CF-1 完了の根拠）|

---

*作成: CTO 真鍋玲央 / 2026-05-12*  
*本ドキュメントに `.env` / credentials の内容は一切含まない*
