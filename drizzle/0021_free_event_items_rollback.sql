-- 0021_free_event_items_rollback — 無料アイテムの行と列を消す（同期で作り直せる）
BEGIN;
DELETE FROM "whowatch_item_groups" WHERE "is_free" = true;
ALTER TABLE "whowatch_item_groups" DROP COLUMN IF EXISTS "is_free";
ALTER TABLE "whowatch_events" DROP COLUMN IF EXISTS "item_group_key";
COMMIT;
