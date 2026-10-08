# _moved_workers_20261008 — Render 向けサービスの退避先（2026-10-08）

削除ではなく退避（Never auto-delete）。元の場所・退避日・理由・戻し方をここに残す。

## 退避したもの（2026-10-08・git mv・履歴は保持）

| 退避前 | 退避後 | 内容 |
|---|---|---|
| `workers/whowatch-poller/` | `_moved_workers_20261008/whowatch-poller/` | whowatch 公開 API を 5 秒ごとにポーリングして Supabase の `events` に INSERT する Render 用 Node 常駐サービス（旧名 fuwacchi-poller）。PR #100（2026-10-08）で入れた `POLLER_KEY` の検査はそのまま残している（戻すときの前提） |
| `workers/youtube-relay/` | `_moved_workers_20261008/youtube-relay/` | YouTube Live Chat の OAuth 中継サーバーの雛形（`/health` だけ・26 行）。Phase 3a-2 で実装予定のまま未着手 |
| `render.yaml` | `_moved_workers_20261008/render.yaml` | Render Blueprint（`tagdeck-whowatch-poller` の定義） |

`workers/_check/oauth_tokens_check.mjs` は Render のサービスではないので元の場所に残した。

## 理由

- セキュリティ監査 2026-10-08 §3-10（`docs/security/tagdeck_security_audit_20261008.md`）: TagDeck 本体（`src/`）はどちらも呼んでいない
- 社長が Render の管理画面で確認（2026-10-08）: 「無い（Render は使っていない・該当サービスが無い）」
- 外形: `tagdeck-whowatch-poller.onrender.com` と旧名 `tagdeck-fuwacchi-poller.onrender.com` はどちらも 404 + `x-render-routing: no-server`（その名前のサービスが Render に無い応答）。`youtube-relay` は render.yaml に無く、配備されたことがない
- `tsconfig.json` の `exclude` に `_moved_workers_20261008/**/*` を足してある（`workers/**/*` と同じ扱い。無いと `ws`・`dotenv` の型が無く `tsc --noEmit` が落ちる）

## 戻し方

1. `git mv _moved_workers_20261008/whowatch-poller workers/whowatch-poller`（`youtube-relay`・`render.yaml` も同様に元の場所へ）
2. `tsconfig.json` の `exclude` から `_moved_workers_20261008/**/*` を外す（`workers/**/*` は残す）
3. Render の Blueprint をリポジトリに接続し直し、環境変数（`SUPABASE_URL`・`SUPABASE_SERVICE_ROLE_KEY`・`WHOWATCH_DEVICE_ID`・`POLLER_KEY`）を社長が Render 側で設定する（値はチャットに貼らない）
4. `docs/architecture/tagdeck_architecture_v1.md` と `docs/migration/phase3_plan_v1.0.md` §7.1 の 2026-10-08 追記を更新する
