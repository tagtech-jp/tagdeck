# 【社長作業】whowatch_events.title_ja クリーンアップ適用手順書 (2026-07-19)

> 作成: Claude Code（TagTech）／ブランチ: `feat/tagdeck-event-picker-fix-20260719`
> **SQL は生成・検証済みだが未適用。適用は社長のみ（CC は本番 Supabase 非接触）。**

## 背景

旧スクレイパー（本 PR で廃止）は `whowatch.tv/events/{event_key}` ページの `<title>` /
`og:title` から日本語イベント名を抽出する設計だったが、実際のサーバーHTMLは Angular SPA
の全ルート共通シェルで、常に共通タイトル「ふわっち - みんなのライブ配信！」を返す
（2026-07-19 実機確認）。この共通タイトルがそのまま `title_ja` に保存されてしまった行が
DB に残っている可能性がある。

本 PR で表示名解決は「手動辞書 → 整形 event_key」の2段に変更済みのため `title_ja` は
表示に使われなくなるが、データ品質のため汚染行は NULL に戻しておく。

## 前提

- 本クリーンアップは `whowatch_event_title_migration_20260719.md`（`started_at` /
  `title_ja` 列追加）が適用済みであることが前提。列が無い場合はエラーになるので
  先にそちらを適用すること。

## 手順

### 1. 事前確認
`docs/ops/whowatch_title_ja_cleanup_20260719.sql` の「1. 事前確認」を Supabase SQL Editor
で実行し、対象行数・id・event_key をメモする。

### 2. クリーンアップ実行
同ファイルの「2. クリーンアップ」を実行する（`UPDATE ... SET title_ja = NULL WHERE
title_ja LIKE '%みんなのライブ配信%'`）。

### 3. 事後確認（**期待結果と一致するまで完了扱いにしない**）
同ファイルの「3. 事後確認」を実行し、**0 行** であることを確認する。

## 補足

- 冪等: 対象が無ければ 0 行 UPDATE で終わるため、複数回実行しても安全。
- 本 PR 以降、スクレイパーが廃止されたため新規の汚染は発生しない（一度きりの過去データ修正）。
