-- 0019_se_bucket_limits — SE 音源バケットの上限を 5MB → 20MB にし、m4a / aac を受け付ける（2026-09-26）
-- 背景: 社長報告「音源がアップロードできなくなった」。WAV は 30 秒で 5MB を超え、iPhone のボイスメモ等は m4a。
--       アプリ側（/api/se/upload・SE タブ）の上限と拡張子は同時に変更している。
-- 適用: Supabase SQL Editor で drizzle/0019_se_bucket_limits_manual.sql を実行（docs/migration-runbook.md）
-- ロールバック: drizzle/0019_se_bucket_limits_rollback.sql
-- 冪等: UPDATE のみ（バケットが無ければ 0014 を先に適用）
UPDATE storage.buckets
SET file_size_limit = 20971520,
    allowed_mime_types = ARRAY['audio/mpeg','audio/mp3','audio/ogg','audio/wav','audio/x-wav','audio/wave','audio/mp4','audio/aac','audio/x-m4a']
WHERE id = 'se';
