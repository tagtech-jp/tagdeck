-- 0026_delete_own_account_manual — Supabase SQL Editor 貼付用（本文は 0026_delete_own_account.sql と同一・トランザクション付き）
BEGIN;

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
REVOKE EXECUTE ON FUNCTION public.delete_own_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated;
NOTIFY pgrst, 'reload schema';

COMMIT;

-- 確認（コメントアウトしない）: 1 行が返り、次の値なら適用済み
--   owner                 = postgres … 関数の持ち主（SECURITY DEFINER はこの役割で動く）
--   secdef                = true     … SECURITY DEFINER になっている
--   auth_exec             = true     … ログイン済みの利用者（authenticated）が呼べる
--   anon_exec             = false    … 公開の鍵（anon）からは呼べない
--   owner_can_delete_auth = true     … 持ち主が auth.users の行を消せる
-- 行が返らない、または anon_exec が true・owner_can_delete_auth が false なら、PR をマージせずこの結果をそのまま報告する
-- （owner_can_delete_auth が false のときは、関数は実行時に権限エラーになる。回避策を試さず、案 B（Service Role Key）の検討へ）
SELECT p.proowner::regrole::text AS owner,
       p.prosecdef AS secdef,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
       has_table_privilege(p.proowner, 'auth.users', 'DELETE') AS owner_can_delete_auth
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'delete_own_account';

-- 適用後の動作確認（本番にしか DB が無いので、docs/migration-runbook.md §5 のとおりテスト用の利用者を Admin API で作って行う）:
--   テスト用の利用者でログイン → 設定 → プロファイル → 「アカウントを削除する」→「削除」と入力 → 実行
--   → トップへ戻り、再ログインできないこと。SQL で次が 0 になること
--   SELECT count(*) FROM auth.users WHERE id = '<テスト用の id>';
--   SELECT count(*) FROM public.users WHERE id = '<テスト用の id>';
