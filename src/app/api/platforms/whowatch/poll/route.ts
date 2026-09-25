import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { streamerProfiles, eventSimulators } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { pollWhowatchStreamerState } from "@/lib/platforms/whowatch";
import { syncSimulatorRanking } from "@/lib/whowatch/ranking-sync";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = createDbClient();
  const [profile] = await db
    .select()
    .from(streamerProfiles)
    .where(eq(streamerProfiles.userId, user.id))
    .limit(1);

  if (!profile?.whowatchUserId || !profile.whowatchIsMonitoring) {
    return NextResponse.json({ error: "not monitoring" }, { status: 400 });
  }

  const state = await pollWhowatchStreamerState(
    profile.whowatchUserId,
    profile.whowatchPeakViewerCount
  );

  const [updated] = await db
    .update(streamerProfiles)
    .set({
      whowatchLiveId: state.liveId,
      whowatchViewerCount: state.viewerCount,
      whowatchCurrentPoints: state.currentPoints,
      whowatchPeakViewerCount: sql`GREATEST(${streamerProfiles.whowatchPeakViewerCount}, ${state.viewerCount})`,
      whowatchLastPolledAt: new Date(),
    })
    .where(eq(streamerProfiles.userId, user.id))
    .returning();

  // ランキング型のアクティブイベントに対して 25 秒（5 ポール）ごとにランキング更新
  const now = Date.now();
  const activeRankingEvents = await db
    .select()
    .from(eventSimulators)
    .where(
      and(
        eq(eventSimulators.userId, user.id),
        eq(eventSimulators.status, "active"),
        sql`${eventSimulators.eventType} IN ('ranking', 'nice', 'viewer')`
      )
    );

  for (const ev of activeRankingEvents) {
    // E2: ranking_type（公開 API）を優先し、無ければ従来の URL スクレイプ。どちらも無ければスキップ
    if (!ev.rankingType && !ev.eventRankingUrl) continue;

    // rivalsSnapshot のタイムスタンプを確認して 25 秒未満なら skip
    const snapshot = ev.rivalsSnapshot as { timestamp: string } | null;
    if (snapshot) {
      const lastFetch = new Date(snapshot.timestamp).getTime();
      if (now - lastFetch < 25_000) continue;
    }

    try {
      // 取得→自分特定→ライバル選定→event_simulators 更新→ranking_snapshots 追記（refresh-ranking と同一処理）
      await syncSimulatorRanking(db, ev);
    } catch (err) {
      // ランキング取得失敗はポーリング全体を止めない
      console.warn(`[poll] ranking fetch failed for event ${ev.id}:`, err);
    }
  }

  return NextResponse.json({
    isLive: state.isLive,
    liveId: updated!.whowatchLiveId,
    liveUrl: state.liveUrl,
    viewerCount: updated!.whowatchViewerCount,
    currentPoints: updated!.whowatchCurrentPoints,
    peakViewerCount: updated!.whowatchPeakViewerCount,
    // 集計値のみ・DB非永続化（poll結果をそのまま素通し）。
    // comment_count/item_countは実機再検証の結果、信頼性未確認のため意図的に含めない（(要確認)）。
    totalViewCount: state.totalViewCount,
    niceCount: state.niceCount,
  });
}
