-- 0019_se_bucket_limits_manual — Supabase SQL Editor 貼付用（本文は 0019_se_bucket_limits.sql と同一・トランザクション付き）
BEGIN;

UPDATE storage.buckets
SET file_size_limit = 20971520,
    allowed_mime_types = ARRAY['audio/mpeg','audio/mp3','audio/ogg','audio/wav','audio/x-wav','audio/wave','audio/mp4','audio/aac','audio/x-m4a']
WHERE id = 'se';

COMMIT;

-- 適用後の確認
-- SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'se';  -- 20971520 と 9 種類
