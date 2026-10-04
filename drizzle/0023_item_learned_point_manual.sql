-- 0023_item_learned_point_manual — Supabase SQL Editor 貼付用（本文は 0023_item_learned_point.sql と同一・トランザクション付き）
BEGIN;

ALTER TABLE "item_point_mapping" ADD COLUMN IF NOT EXISTS "learned_point" double precision;
ALTER TABLE "item_point_mapping" ADD COLUMN IF NOT EXISTS "learned_samples" integer DEFAULT 0 NOT NULL;
ALTER TABLE "item_point_mapping" ADD COLUMN IF NOT EXISTS "learned_at" timestamptz;
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

COMMIT;

-- 確認（コメントアウトしない）: 1 行が返り、次の値なら適用済み
--   learned_cols = 3        … 列が 3 つ足された（0 なら足されていない）
--   anon_price   = true     … 既存の列はこれまでどおり誰でも読める
--   anon_learned = false    … 学習単価は公開の鍵では読めない
--   auth_learned = false    … ログインしただけの利用者も読めない
--   owner        = postgres … 表の持ち主（REVOKE が効く前提。anon_learned が true のときの原因調べに使う）
-- learned_cols が 3 でない、または anon_learned / auth_learned が true なら、PR をマージせずにこの 1 行をそのまま報告する
SELECT (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'item_point_mapping'
           AND column_name IN ('learned_point', 'learned_samples', 'learned_at')) AS learned_cols,
       has_column_privilege('anon', 'public.item_point_mapping', 'price_jpy', 'SELECT') AS anon_price,
       has_column_privilege('anon', 'public.item_point_mapping', 'learned_point', 'SELECT') AS anon_learned,
       has_column_privilege('authenticated', 'public.item_point_mapping', 'learned_point', 'SELECT') AS auth_learned,
       (SELECT relowner::regrole::text FROM pg_class WHERE oid = 'public.item_point_mapping'::regclass) AS owner;
