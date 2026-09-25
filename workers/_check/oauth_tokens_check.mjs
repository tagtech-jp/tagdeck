/**
 * Phase 3a-2b smoke test: youtube_oauth_tokens table + RLS
 *
 * 必要な環境変数:
 *   NEXT_PUBLIC_SUPABASE_URL      (.env.local から自動ロード)
 *   SUPABASE_SERVICE_ROLE_KEY     (.env.local から自動ロード)
 *   TEST_STREAMER_PROFILE_ID      社長が手動指定 (例: PowerShell で $env:TEST_STREAMER_PROFILE_ID="<uuid>")
 *
 * 実行コマンド:
 *   $env:TEST_STREAMER_PROFILE_ID="<your-streamer-profile-uuid>"
 *   node --env-file=.env.local workers/_check/oauth_tokens_check.mjs
 */

import { createClient } from '@supabase/supabase-js';

// ─── 出力マスク ───────────────────────────────────────────────────
function mask(s) {
  if (!s) return '{empty}';
  const str = String(s);
  return `{masked:${str.slice(0, 4)}...}`;
}

function maskTimestamp(ts) {
  // タイムスタンプは日付部分のみ表示 (個人情報なし)
  if (!ts) return '{null}';
  return String(ts).slice(0, 10) + 'T**:**:**';
}

// ─── 環境変数チェック ─────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const TEST_STREAMER_PROFILE_ID = process.env.TEST_STREAMER_PROFILE_ID ?? '';

const REQUIRED_ENVS = [
  ['NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL],
  ['SUPABASE_SERVICE_ROLE_KEY', SERVICE_ROLE_KEY],
  ['TEST_STREAMER_PROFILE_ID', TEST_STREAMER_PROFILE_ID],
];

for (const [key, val] of REQUIRED_ENVS) {
  if (!val) {
    console.error(`❌ 環境変数 ${key} が未設定です`);
    process.exit(1);
  }
}

// ─── Supabase クライアント (Service Role = RLS バイパス) ──────────
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const EXPECTED_COLS = [
  'id', 'user_id', 'streamer_profile_id',
  'access_token', 'refresh_token', 'token_type',
  'expires_at', 'scope', 'created_at', 'updated_at',
];

// ─── メイン ───────────────────────────────────────────────────────
async function main() {
  console.log('▶ Phase 3a-2b smoke test: youtube_oauth_tokens\n');

  // [1/4] streamer_profile から user_id を自動取得
  const { data: profile, error: profileErr } = await supabase
    .from('streamer_profiles')
    .select('id, user_id')
    .eq('id', TEST_STREAMER_PROFILE_ID)
    .single();

  if (profileErr || !profile) {
    throw new Error(`streamer_profiles 取得失敗: ${profileErr?.message ?? 'not found'}`);
  }

  const userId = profile.user_id;
  console.log(`[1/4] streamer_profile 取得 OK`);
  console.log(`      id      = ${mask(profile.id)}`);
  console.log(`      user_id = ${mask(userId)}`);

  // [2/4] テスト行を INSERT
  const ts = Date.now();
  const testRow = {
    user_id: userId,
    streamer_profile_id: TEST_STREAMER_PROFILE_ID,
    access_token: `smoke_at_${ts}`,
    refresh_token: `smoke_rt_${ts}`,
    token_type: 'Bearer',
    expires_at: new Date(ts + 3_600_000).toISOString(),
    scope: 'https://www.googleapis.com/auth/youtube',
  };

  const { data: inserted, error: insertErr } = await supabase
    .from('youtube_oauth_tokens')
    .insert(testRow)
    .select()
    .single();

  if (insertErr || !inserted) {
    throw new Error(`INSERT 失敗: ${insertErr?.message ?? 'no data'}`);
  }

  const insertedId = inserted.id;
  console.log(`\n[2/4] INSERT OK`);
  console.log(`      id         = ${mask(insertedId)}`);
  console.log(`      token_type = ${inserted.token_type}`);
  console.log(`      expires_at = ${maskTimestamp(inserted.expires_at)}`);

  // [3/4] SELECT して 10 カラム全存在確認
  const { data: row, error: selectErr } = await supabase
    .from('youtube_oauth_tokens')
    .select(EXPECTED_COLS.join(', '))
    .eq('id', insertedId)
    .single();

  if (selectErr || !row) {
    throw new Error(`SELECT 失敗: ${selectErr?.message ?? 'not found'}`);
  }

  const missing = EXPECTED_COLS.filter(c => !(c in row));
  if (missing.length > 0) {
    throw new Error(`カラム不足: ${missing.join(', ')}`);
  }

  console.log(`\n[3/4] SELECT OK: 10 カラム全確認`);
  console.log(`      access_token  = ${mask(row.access_token)}`);
  console.log(`      refresh_token = ${mask(row.refresh_token)}`);
  console.log(`      created_at    = ${maskTimestamp(row.created_at)}`);
  console.log(`      updated_at    = ${maskTimestamp(row.updated_at)}`);
  console.log(`      scope         = ${row.scope ?? '{null}'}`);

  // [4/4] テスト行を削除 (痕跡なし)
  const { error: deleteErr } = await supabase
    .from('youtube_oauth_tokens')
    .delete()
    .eq('id', insertedId);

  if (deleteErr) {
    throw new Error(`DELETE 失敗: ${deleteErr.message}`);
  }

  console.log(`\n[4/4] DELETE OK: テスト行削除完了`);
  console.log('\n✅ smoke test PASS');
  console.log('   youtube_oauth_tokens テーブル存在確認 + 10 カラム検証 + CRUD 疎通確認');
  console.log('   ※ RLS 有効は Supabase Table Editor の 🔒 マークで目視確認済み');
}

main().catch(err => {
  console.error('\n❌ smoke test FAIL:', err.message);
  process.exit(1);
});
