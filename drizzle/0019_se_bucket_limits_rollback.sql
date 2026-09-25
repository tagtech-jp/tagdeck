-- 0019_se_bucket_limits_rollback — 0014 の値（5MB・mp3/ogg/wav）に戻す。既にアップロード済みの大きいファイルは残る（再生も可）
BEGIN;
UPDATE storage.buckets
SET file_size_limit = 5242880,
    allowed_mime_types = ARRAY['audio/mpeg','audio/mp3','audio/ogg','audio/wav','audio/x-wav','audio/wave']
WHERE id = 'se';
COMMIT;
