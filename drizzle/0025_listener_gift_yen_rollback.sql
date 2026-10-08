-- 0025_listener_gift_yen_rollback — 累計を 2026-10-08 以前の「個数」に戻す。コードを戻す（PR の revert）のが先。
-- whowatch は events の payload.count の合計で戻せる。Kick の「回数」は events に listener_id が無いので戻せない:
-- _manual.sql 冒頭で取った控え docs/backup/listeners_before_0025.sql（UPDATE 文の並び）をこの後に実行する（無ければ 0 のまま）
BEGIN;
UPDATE "listeners" l
   SET "total_gift_amount" = coalesce(s.cnt, 0)
  FROM "listeners" l2
  LEFT JOIN (
    SELECT e.listener_id, sum(CASE WHEN e.payload->>'count' ~ '^[0-9]+$' THEN (e.payload->>'count')::integer ELSE 0 END) AS cnt
      FROM "events" e
     WHERE e.platform = 'whowatch' AND e.event_type = 'gift' AND e.listener_id IS NOT NULL
     GROUP BY e.listener_id
  ) s ON s.listener_id = l2.id
 WHERE l2.id = l.id AND l.platform = 'whowatch';
COMMIT;
-- Kick: docs/backup/listeners_before_0025.sql を実行する（控えが無ければ戻せない。0 のまま）
