-- 0025_listener_gift_yen — listeners.total_gift_amount を「ギフトの定価の合計（円）」にそろえる（2026-10-08・監査 §3-6・社長決定 案A）
-- 背景: whowatch は個数（payload.count）、Kick は 1 回 = 1 を足していて単位が混ざり、/api/listeners の rank 判定
--       （top ≥ ¥50,000 / vip ≥ ¥10,000・円）がほぼ成立していなかった。コード側は同じ PR で
--       「whowatch は total_yen（定価 × 個数）を足す・Kick は足さない」に変えた。この migration は過去分の再集計だけで、
--       列の追加・変更・削除は無い（schema.ts は列コメントの追記のみ）。
-- 計算: whowatch のギフト（events.platform='whowatch' AND event_type='gift' AND listener_id IS NOT NULL）1 件ごとに
--       ① payload.total_yen（2026-09-26 d2b2543 以降の保存に入っている・price_yen × count）
--       ② 無ければ 現在の単価表 whowatch_item_prices.unit_price_jpy × payload.count（2026-09-26 より前の保存には total_yen が無い。
--          当時の payload.price_yen は「先頭商品の価格」を単価にしていた時期なので使わず、現在の 1 個の単価で引き直す）
--       ③ 無ければ item_point_mapping.price_jpy × payload.count（同じ item_id が複数行ありうる表なので最新 1 行）
--       ④ どれも無ければ 0（無料アイテム・単価不明。推測で埋めない）
--       をリスナーごとに合計して上書きする。Kick のリスナーとギフトの無いリスナーは 0 になる（Kick のギフトは events に回数が残る）。
--       whowatch_item_prices は 0020、item_point_mapping は 0000 の表（どちらも適用済み）
-- 冪等: 何度流しても同じ結果（events から毎回計算し直す）。マージの前後どちらで流してもよい:
--       マージ前に流すと、流してからデプロイまでの間だけ旧コードが個数を足すので、デプロイ後にもう一度流せば直る。
--       マージ後に流すまでの間は、新コードが足した円に旧来の個数が混ざったままになる（流せば直る）
-- 適用: Supabase SQL Editor で drizzle/0025_listener_gift_yen_manual.sql を実行（docs/migration-runbook.md）
-- ロールバック: drizzle/0025_listener_gift_yen_rollback.sql（whowatch の個数は events から戻せる。Kick の回数は events に
--               listener_id が無いので戻せない → _manual.sql 冒頭の控えを先に取る）
UPDATE "listeners" l
   SET "total_gift_amount" = coalesce(s.yen, 0)
  FROM "listeners" l2
  LEFT JOIN (
    SELECT e.listener_id, sum(coalesce(
              CASE WHEN e.payload->>'total_yen' ~ '^[0-9]+$' THEN (e.payload->>'total_yen')::integer END,
              (SELECT p.unit_price_jpy FROM "whowatch_item_prices" p
                WHERE p.item_id = (CASE WHEN e.payload->>'item_id' ~ '^[0-9]+$' THEN (e.payload->>'item_id')::integer END))
                * (CASE WHEN e.payload->>'count' ~ '^[0-9]+$' THEN (e.payload->>'count')::integer END),
              (SELECT m.price_jpy FROM "item_point_mapping" m
                WHERE m.platform = 'whowatch' AND m.item_id = e.payload->>'item_id'
                ORDER BY m.last_fetched_at DESC LIMIT 1)
                * (CASE WHEN e.payload->>'count' ~ '^[0-9]+$' THEN (e.payload->>'count')::integer END),
              0)) AS yen
      FROM "events" e
     WHERE e.platform = 'whowatch' AND e.event_type = 'gift' AND e.listener_id IS NOT NULL
     GROUP BY e.listener_id
  ) s ON s.listener_id = l2.id
 WHERE l2.id = l.id;
