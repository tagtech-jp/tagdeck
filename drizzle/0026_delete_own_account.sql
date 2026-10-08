-- 0025_delete_own_account — 退会（本人によるアカウント削除）の DB 関数（2026-10-08・セキュリティ監査 §3-7）
-- 背景: 利用者が自分のアカウントとデータを消す導線が無く、Supabase の管理画面で社長が消す運用だった。
--       Worker には Service Role Key を置いていない（置かない方針）ので、auth.users の削除は SECURITY DEFINER の関数に
--       閉じ込め、呼び出し元（POST /api/account/delete）は本人のログインで supabase.rpc() を呼ぶだけにする。
-- 動き: auth.uid()（呼び出した本人）の行だけを、子の表から順に消す。public の外部キーは ON DELETE no action が大半
--       （streamer_profiles / listeners / events / event_simulators / event_history）なので連鎖削除に頼らず明示的に消す。
--       最後に auth.users の行を消すと、auth.identities / auth.sessions / auth.refresh_tokens 等は Supabase 側の外部キー（CASCADE）で消える。
--       public.users は auth.users への外部キーを持たない（0000）ので、auth.users を消しても public 側は自動では消えない。だからこの関数で消す。
-- 対象外: 全利用者共有のマスタ（item_point_mapping・event_item_points・whowatch_events・whowatch_item_*）は利用者の行を持たないので触らない。
--         Storage（バケット se の {user_id}/…）は API ルートが本人の権限で先に消す（SQL で storage.objects を消すとファイル実体が残るため）。
-- 一覧: 消える表と順番は docs/ops/account_deletion_20261008.md
-- 適用: Supabase SQL Editor で drizzle/0025_delete_own_account_manual.sql を実行（docs/migration-runbook.md）
-- ロールバック: drizzle/0025_delete_own_account_rollback.sql（関数を落とすだけ。消したデータは戻らない）
-- 冪等: CREATE OR REPLACE / REVOKE・GRANT は何度流しても同じ状態
-- 未適用のとき: ルートは PostgREST の「関数が無い」（PGRST202）を 503 で返し、画面に「準備中」と出す。適用前にマージしても壊れない
CREATE OR REPLACE FUNCTION public.delete_own_account()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
  n_events integer; n_listeners integer; n_tokens integer; n_profiles integer;
  n_snapshots integer; n_simulators integer; n_history integer;
  n_mappings integer; n_presets integer; n_users integer; n_auth integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'delete_own_account: not authenticated' USING ERRCODE = '28000';
  END IF;

  -- 配信者プロフィール配下（視聴者の記録）。events は listeners を参照するので先に消す
  DELETE FROM public.events e USING public.streamer_profiles p WHERE e.streamer_id = p.id AND p.user_id = uid;
  GET DIAGNOSTICS n_events = ROW_COUNT;
  DELETE FROM public.listeners l USING public.streamer_profiles p WHERE l.streamer_id = p.id AND p.user_id = uid;
  GET DIAGNOSTICS n_listeners = ROW_COUNT;
  DELETE FROM public.youtube_oauth_tokens WHERE user_id = uid;
  GET DIAGNOSTICS n_tokens = ROW_COUNT;
  DELETE FROM public.streamer_profiles WHERE user_id = uid;
  GET DIAGNOSTICS n_profiles = ROW_COUNT;

  -- イベント勝率シミュレーター（status='deleted' の論理削除済みの行も物理削除する）
  DELETE FROM public.ranking_snapshots s USING public.event_simulators sim WHERE s.simulator_id = sim.id AND sim.user_id = uid;
  GET DIAGNOSTICS n_snapshots = ROW_COUNT;
  DELETE FROM public.event_simulators WHERE user_id = uid;
  GET DIAGNOSTICS n_simulators = ROW_COUNT;
  DELETE FROM public.event_history WHERE user_id = uid;
  GET DIAGNOSTICS n_history = ROW_COUNT;

  -- SE（割り当てとプリセット。音源ファイルは API ルートが Storage API で消している）
  DELETE FROM public.se_mappings WHERE user_id = uid;
  GET DIAGNOSTICS n_mappings = ROW_COUNT;
  DELETE FROM public.se_presets WHERE owner_user_id = uid;
  GET DIAGNOSTICS n_presets = ROW_COUNT;

  -- 利用者本体。auth.users を消すと auth.identities / auth.sessions / auth.refresh_tokens は Supabase 側の CASCADE で消える
  DELETE FROM public.users WHERE id = uid;
  GET DIAGNOSTICS n_users = ROW_COUNT;
  DELETE FROM auth.users WHERE id = uid;
  GET DIAGNOSTICS n_auth = ROW_COUNT;

  RETURN jsonb_build_object(
    'user_id', uid,
    'events', n_events,
    'listeners', n_listeners,
    'youtube_oauth_tokens', n_tokens,
    'streamer_profiles', n_profiles,
    'ranking_snapshots', n_snapshots,
    'event_simulators', n_simulators,
    'event_history', n_history,
    'se_mappings', n_mappings,
    'se_presets', n_presets,
    'users', n_users,
    'auth_users', n_auth
  );
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.delete_own_account() FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
