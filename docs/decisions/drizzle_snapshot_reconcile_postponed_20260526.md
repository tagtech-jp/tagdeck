# Drizzle Snapshot Reconcile - Postponed

| 項目 | 値 |
|---|---|
| 起案日 | 2026-05-26 |
| 起案者 | 社長 + claude.ai 側 Claude |
| 実装担当 | Claude Code (TagDeck セッション) |
| 関連 Notion | 3689c9fc-a962-81ac-b23c-c0027ef800e0 |
| 関連 commit | 83f0531 (journal 登録), e51d5c4 (0006 journal 登録) |

## 1. 背景

drizzle/0004_events_3cols.sql / 0005_youtube_oauth_tokens.sql / 0006_fuwacchi_event_id.sql に対応する snapshot JSON が drizzle/meta/ 配下に存在しない。journal 登録は 2026-05-22 (83f0531) + 2026-05-26 (e51d5c4) で完了済みだが、snapshot 補完は未完。

## 2. 試行した案

### 案α (drizzle-kit パッチ升格 + pull)

- drizzle-kit 0.31.10 の check constraint バグ (TypeError: Cannot read properties of undefined (reading 'replace')) で pull がクラッシュ
- 0.31.x にパッチ版が存在せず、STOP S1 発動
- 修正は 1.0.0-beta.12 以降 (現在 1.0.0-rc.4 が最新で stable 未リリース)

### 案α-3 (1.0.0-rc.4 升格)

- 本番稼働中プロダクトに RC 版採用は規律違反スレスレ
- drizzle.config.ts の breaking changes リスク

### 案β (drizzle-kit generate で schema.ts から再構築)

- schema.ts の event_simulators.fuwacchi_event_id に FK 制約未反映
- 案β を採ると本番 DB と snapshot の乖離が固定化される

### 案γ (手動構築)

- 9 tables / 92 columns のミスリスク

### 案ε (schema.ts FK 修正 + 案β)

- スコープ超過

## 3. 採択: 案δ (現状維持)

- snapshot 不足は日常運用に影響なし
- journal idx 整合は登録済 (83f0531, e51d5c4)
- 次回 migration 追加時のみ顕在化
- drizzle-kit 1.0.0 stable リリース後に pull で正確な snapshot を取得可能

## 4. 次の action

- drizzle-kit 1.0.0 stable リリース監視 (定期確認)
- リリース後: pull → snapshot 0004/0005/0006 補完 → commit
- 関連 issue (別タスク化候補): schema.ts の event_simulators.fuwacchi_event_id に FK 制約未反映 (pre-existing)

## 5. 影響

- TagDeck 本番影響: なし
- 他 CC セッション影響: なし (本ファイルが正本)

## 6. 履歴

| 版 | 日付 | 改訂内容 | 承認者 |
|---|---|---|---|
| 1.0 | 2026-05-26 | 初版起案 | 社長 |
| 1.1 | 2026-07-18 | 再確認: journal (`_journal.json`) は idx 0〜6 全7件登録済みと実地確認（journal自体の未記載問題は解消済み）。snapshot JSON欠落（0004/0005/0006分）は状況変化なし（drizzle-kit依然 `^0.31.10`）。案δ（現状維持）を継続。TagDeck仕様書v1 §8-2 で社長再承認 | 社長 |
