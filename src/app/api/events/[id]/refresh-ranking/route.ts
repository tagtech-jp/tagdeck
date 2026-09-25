import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { eventSimulators } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { WhowatchRankingException } from "@/lib/platforms/whowatch-ranking";
import { syncSimulatorRanking } from "@/lib/whowatch/ranking-sync";
import { WhowatchRankingApiError } from "@/lib/whowatch/rankings";

/**
 * POST /api/events/[id]/refresh-ranking → 「今すぐ更新」
 * E2: ranking_type があれば公開 API（/rankings/{type}）で取得し ranking_snapshots に追記。
 *     無ければ従来のイベントランキング URL スクレイプにフォールバック（旧経路は削除しない）。
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createDbClient();
  const [event] = await db
    .select()
    .from(eventSimulators)
    .where(and(eq(eventSimulators.id, id), eq(eventSimulators.userId, user.id)))
    .limit(1);

  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!event.rankingType && !event.eventRankingUrl) {
    return NextResponse.json(
      { error: "ランキング区分もイベントランキング URL も未設定" },
      { status: 400 }
    );
  }

  try {
    const result = await syncSimulatorRanking(db, event);
    if (!result.myEntry && result.rivals.length === 0) {
      return NextResponse.json({
        success: false,
        message: result.message ?? "ランキングデータが取得できませんでした。手動入力をご利用ください。",
        rankings: [],
        source: result.source,
      });
    }
    return NextResponse.json({
      success: true,
      source: result.source,
      myEntry: result.myEntry,
      rivals: result.rivals,
      snapshotId: result.snapshotId,
      status: result.status,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[refresh-ranking]", error);
    const message =
      error instanceof WhowatchRankingException || error instanceof WhowatchRankingApiError
        ? error.message
        : "ランキング取得に失敗しました。手動入力をご利用ください。";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
