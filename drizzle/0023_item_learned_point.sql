-- 0023_item_learned_point — 配信者が実際に受け取ったポイントから学習した「アイテム 1 個の単価」（2026-10-04）
-- 背景: price_jpy は定価（円）で、配信者が実際に受け取る whowatch のポイントとは一致しない（社長報告「額に差異がある」）。
--       erupi-commentbot が https://whowatch.tv/present（配信者本人でログインして見る「配信中に使われたアイテム」）の
--       獲得ポイントとアイテムの個数の増え方から 1 個あたりのポイントを割り出し（観測の中央値）、ここに書く。
--       社長決定（2026-10-04）: 既存の単価表（item_point_mapping）に列を足す（B 案）
-- 適用: Supabase SQL Editor で drizzle/0023_item_learned_point_manual.sql を実行（docs/migration-runbook.md）
-- ロールバック: drizzle/0023_item_learned_point_rollback.sql
-- 冪等: ADD COLUMN IF NOT EXISTS。権限の付け直しも何度流しても同じ状態になる
-- 書き込み: POST /api/platforms/whowatch/items/learned（X-Sync-Key・DATABASE_URL 直結）が learned_* の 3 列だけを更新する。
--          日次同期（sync_items_and_events.py の resolution=merge-duplicates）は送った列しか更新しないため、3 列は上書きされない
-- 読み取り: 学習単価は運営者（えるぴ）の実際の収益の比率なので、公開の読み取り（anon / authenticated）からは外す。
--          この表は「GRANT SELECT … TO anon, authenticated」（公開の鍵で誰でも読める）なので、表単位の SELECT を外し、
--          learned_* 以外の列にだけ SELECT を付け直す（PostgreSQL は表単位の REVOKE で列単位の権限も外れるため、この順）。
--          TagDeck はサーバ（DATABASE_URL）、日次同期は service_role で読むので影響しない
--          （2026-10-04 確認: anon / authenticated の鍵でこの表を読むコードは TagDeck・tagtech-OBS・mt5-trader・million-tag に無い。
--           外部ツールは items/export を使い、learned_* は X-Sync-Key のときだけ返す）。公開に戻す SQL は _rollback.sql の末尾
ALTER TABLE "item_point_mapping" ADD COLUMN IF NOT EXISTS "learned_point" double precision;
--> statement-breakpoint
ALTER TABLE "item_point_mapping" ADD COLUMN IF NOT EXISTS "learned_samples" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "item_point_mapping" ADD COLUMN IF NOT EXISTS "learned_at" timestamptz;
--> statement-breakpoint
DO $$
DECLARE
  cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'item_point_mapping'
     AND column_name NOT IN ('learned_point', 'learned_samples', 'learned_at');
  EXECUTE 'REVOKE SELECT ON public.item_point_mapping FROM anon, authenticated';
  EXECUTE format('GRANT SELECT (%s) ON public.item_point_mapping TO anon, authenticated', cols);
END $$;
