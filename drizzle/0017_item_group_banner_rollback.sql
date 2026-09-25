-- 0017_item_group_banner_rollback — 追加した 2 列を落とす（同期で作り直せるので損失は無い）
-- 注意: 0017 適用前のコード（バナー列を SELECT しない版）に戻す場合だけ実行する。
--       0017 以降のコードのまま列を落とすと items/patterns ルートの SELECT が失敗する
BEGIN;
ALTER TABLE "whowatch_item_groups" DROP COLUMN IF EXISTS "banner_url";
ALTER TABLE "whowatch_item_groups" DROP COLUMN IF EXISTS "description";
COMMIT;
