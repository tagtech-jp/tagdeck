// events_columns_check.ts — Phase 3a-2a カラム追加疎通確認スクリプト
// 使い方: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx ts-node events_columns_check.ts
//         または .env を同ディレクトリに置いてそのまま実行
//
// stream_id / platform_comment_id / moderated の 3 カラムに値を INSERT → SELECT → DELETE する。
// 完了後に痕跡は残らない。

import { config } from "dotenv";
config();

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL ?? "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!supabaseUrl || !supabaseKey) {
  console.error("[check] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// smoke.ts と同じ実在 streamer_profiles UUID を使用
const TEST_STREAMER_ID = process.env.TEST_STREAMER_ID ?? "00000000-0000-0000-0000-000000000000";

async function main(): Promise<void> {
  console.log("[check] Phase 3a-2a events カラム追加疎通確認 開始...");
  console.log(`[check] streamer_id: ${TEST_STREAMER_ID}`);

  // --- INSERT ---
  const { data: inserted, error: insertError } = await supabase
    .from("events")
    .insert({
      streamer_id: TEST_STREAMER_ID,
      platform: "whowatch",
      event_type: "col_check",
      payload: { note: "phase3a-2a column check" },
      occurred_at: new Date().toISOString(),
      stream_id: "check-stream-001",
      platform_comment_id: "check-comment-001",
      moderated: false,
    })
    .select()
    .single();

  if (insertError) {
    console.error("[check] INSERT 失敗:", insertError.message);
    process.exit(1);
  }

  const insertedId: string = (inserted as { id: string }).id;
  console.log("[check] INSERT 成功:", JSON.stringify(inserted, null, 2));

  // --- SELECT で 3 カラム検証 ---
  const { data: fetched, error: fetchError } = await supabase
    .from("events")
    .select("id, stream_id, platform_comment_id, moderated")
    .eq("id", insertedId)
    .single();

  if (fetchError) {
    console.error("[check] SELECT 失敗:", fetchError.message);
    process.exit(1);
  }

  const row = fetched as {
    id: string;
    stream_id: string | null;
    platform_comment_id: string | null;
    moderated: boolean | null;
  };

  console.log("\n[check] === 3 カラム検証 ===");
  const streamIdOk = row.stream_id === "check-stream-001";
  const commentIdOk = row.platform_comment_id === "check-comment-001";
  const moderatedOk = row.moderated === false;

  console.log(`  stream_id:          ${row.stream_id} ${streamIdOk ? "✅" : "❌"}`);
  console.log(`  platform_comment_id: ${row.platform_comment_id} ${commentIdOk ? "✅" : "❌"}`);
  console.log(`  moderated:          ${row.moderated} ${moderatedOk ? "✅" : "❌"}`);

  const allOk = streamIdOk && commentIdOk && moderatedOk;

  // --- DELETE（痕跡を残さない）---
  const { error: deleteError } = await supabase
    .from("events")
    .delete()
    .eq("id", insertedId);

  if (deleteError) {
    console.error("[check] DELETE 失敗:", deleteError.message);
    console.warn(`[check] 手動で DELETE FROM events WHERE id = '${insertedId}'; を実行してください`);
    process.exit(1);
  }

  console.log("\n[check] DELETE 完了（痕跡なし）");

  if (allOk) {
    console.log("\n[check] ✅ Phase 3a-2a 疎通確認 PASS — 3 カラムすべて正常動作");
    process.exit(0);
  } else {
    console.error("\n[check] ❌ 一部カラムが期待値と異なります。上記 ❌ を確認してください");
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error("[check] 予期しないエラー:", err);
  process.exit(1);
});
