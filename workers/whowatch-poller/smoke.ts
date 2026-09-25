// smoke.ts — whowatch-poller 疎通確認スクリプト（ts-node 手動実行用）
// 使い方: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx ts-node smoke.ts
//         または .env を同ディレクトリに置いてそのまま実行
//
// 実行後 Supabase events テーブルに event_type='smoke_test' の行が 1 件 INSERT される。
// 確認後は手動で DELETE FROM events WHERE event_type = 'smoke_test'; を実行すること。

import { config } from "dotenv";
config();

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL ?? "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!supabaseUrl || !supabaseKey) {
  console.error("[smoke] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// streamer_id: 実在する streamer_profiles レコードの UUID に差し替えてから実行すること
const TEST_STREAMER_ID = "00000000-0000-0000-0000-000000000000";

async function main(): Promise<void> {
  console.log("[smoke] Supabase INSERT テスト開始...");

  const { data, error } = await supabase
    .from("events")
    .insert({
      streamer_id: TEST_STREAMER_ID,
      platform: "whowatch",
      event_type: "smoke_test",
      payload: {
        live_id: "smoke-live-id",
        title: "smoke test title",
        view_num: 0,
        total_point: 0,
        live_started_at: Math.floor(Date.now() / 1000),
      },
      occurred_at: new Date().toISOString(),
    })
    .select();

  if (error) {
    console.error("[smoke] INSERT 失敗:", error.message);
    process.exit(1);
  }

  console.log("[smoke] INSERT 成功:", JSON.stringify(data, null, 2));
  console.log("[smoke] 確認後: DELETE FROM events WHERE event_type = 'smoke_test'; を実行してください");
}

main().catch((err: unknown) => {
  console.error("[smoke] 予期しないエラー:", err);
  process.exit(1);
});
