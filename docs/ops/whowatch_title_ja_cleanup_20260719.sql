-- whowatch_events.title_ja クリーンアップ (2026-07-19)
-- 背景: 旧スクレイパー (event-title.ts の fetchWhowatchEventTitle) は
-- whowatch.tv/events/{event_key} ページの <title> / og:title から日本語イベント名を
-- 抽出する設計だったが、実際のサーバーHTMLは Angular SPA の全ルート共通シェルで、
-- 常に共通タイトル「ふわっち - みんなのライブ配信！」を返す。そのため cleanEventTitle() の
-- サフィックス除去（「イベント名 ｜ ふわっち」形式を想定）にマッチせず、共通タイトルが
-- そのまま title_ja に保存されてしまっていた。本 PR でスクレイパー自体を廃止したため、
-- 今後は新規の汚染は発生しないが、既存の汚染データは残ったままなので削除する。
--
-- 実行方法: Supabase SQL Editor で「1. 事前確認」→「2. クリーンアップ」→「3. 事後確認」の順に実行。
-- 冪等: 複数回実行しても安全（対象が無ければ 0 行 UPDATE で終わる）。

-- 1. 事前確認（対象行を確認してから次に進む）
SELECT id, event_key, title_ja
FROM whowatch_events
WHERE title_ja LIKE '%みんなのライブ配信%';

-- 2. クリーンアップ（対象行の title_ja を NULL に戻す）
UPDATE whowatch_events
SET title_ja = NULL
WHERE title_ja LIKE '%みんなのライブ配信%';

-- 3. 事後確認（0 行になっていることを確認）
SELECT id, event_key, title_ja
FROM whowatch_events
WHERE title_ja LIKE '%みんなのライブ配信%';
