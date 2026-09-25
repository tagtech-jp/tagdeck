import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { eventSimulators, rankingSnapshots } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { WhowatchRankingException } from "@/lib/platforms/whowatch-ranking";
import { syncSimulatorRanking } from "@/lib/whowatch/ranking-sync";
import { WhowatchRankingApiError } from "@/lib/whowatch/rankings";

/**
 * POST /api/events/[id]/refresh-ranking → 「今すぐ更新」
 * E2: ranking_type があれば公開 API（/rankings/{type}）で取得し ranking_snapshots に追記。
 *     無ければ従来のイベントランキング URL スクレイプにフォールバック（旧経路は削除しない）。
 * 2026-09-25: イベント画面が開いている間は画面側からも自動で呼ぶ（cron 停止時の保険）ため、
 *     直近 THROTTLE_MS 以内にスナップショットがあれば公開 API を叩かずに throttled=true で返す。
 */
const THROTTLE_MS = 45_000;

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

  if (event.rankingType) {
    const [last] = await db
      .select({ id: rankingSnapshots.id, capturedAt: rankingSnapshots.capturedAt, myRank: rankingSnapshots.myRank, myPoint: rankingSnapshots.myPoint })
      .from(rankingSnapshots)
      .where(eq(rankingSnapshots.simulatorId, event.id))
      .orderBy(desc(rankingSnapshots.capturedAt))
      .limit(1);
    if (last && Date.now() - last.capturedAt.getTime() < THROTTLE_MS) {
      return NextResponse.json({
        success: true,
        throttled: true,
        source: "api",
        myEntry: last.myRank !== null && last.myPoint !== null ? { rank: last.myRank, score: last.myPoint } : null,
        rivals: [],
        snapshotId: last.id,
        status: null,
        timestamp: last.capturedAt.toISOString(),
      });
    }
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
