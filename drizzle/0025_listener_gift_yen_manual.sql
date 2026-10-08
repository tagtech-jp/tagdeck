-- 0025_listener_gift_yen_manual — Supabase SQL Editor 貼付用（本文は 0025_listener_gift_yen.sql と同一・トランザクション付き）
--
-- 適用前の記録と控え（docs/migration-runbook.md §3-1・read-only）。先にこの 2 本を別々に実行して結果を保存する:
--   SELECT platform, count(*) AS listeners, sum(total_gift_amount) AS total_before FROM public.listeners GROUP BY platform ORDER BY platform;
--   SELECT format('UPDATE public.listeners SET total_gift_amount = %s WHERE id = %L;', coalesce(total_gift_amount, 0), id) AS stmt
--     FROM public.listeners ORDER BY platform, id;
-- 2 本目の結果（UPDATE 文の並び）を docs/backup/listeners_before_0025.sql に保存する（実データなのでコミット禁止・.gitignore 済み）。
-- ロールバックで Kick の「回数」を戻せるのはこの控えだけ（_rollback.sql 参照）
BEGIN;

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

COMMIT;

-- 確認（コメントアウトしない）: プラットフォームごとに 1 行。mismatch が全行 0 なら適用済み。
--   listeners … リスナー数（適用前の記録と同じ）
--   total_yen … 累計の合計（円）。kick は 0
--   mismatch  … 累計が events からの再計算と一致しない行数。0 でなければ、新コードのデプロイ後にもう一度 BEGIN〜COMMIT を流す
--               （デプロイ前の旧コードが個数を足した分）。それでも 0 にならなければ PR をマージせずにこの結果をそのまま報告する
--   top / vip … rank のしきい値（¥50,000 / ¥10,000）に届くリスナー数（CRM で TOP / VIP が出る目安）
SELECT l.platform,
       count(*)                                                                          AS listeners,
       sum(coalesce(l.total_gift_amount, 0))                                             AS total_yen,
       count(*) FILTER (WHERE coalesce(l.total_gift_amount, 0) <> coalesce(s.yen, 0))    AS mismatch,
       count(*) FILTER (WHERE l.total_gift_amount >= 50000)                              AS top,
       count(*) FILTER (WHERE l.total_gift_amount >= 10000 AND l.total_gift_amount < 50000) AS vip
  FROM "listeners" l
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
  ) s ON s.listener_id = l.id
 GROUP BY l.platform
 ORDER BY l.platform;
