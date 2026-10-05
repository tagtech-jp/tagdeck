import { NextResponse } from "next/server";
import { and, desc, eq, gte, isNotNull, lte } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { eventSimulators, rankingSnapshots } from "@/lib/db/schema";
import { computeRankStatus, type RankStatus } from "@/lib/live/rank-alert";

/**
 * GET /api/live/rank-status → 開催中の自分のイベント（ランキング区分あり）ごとの順位パネル用の値と警告（2026-10-05）。
 * ranking_snapshots の直近 2 枚から計算する。ランキングの取得はしない（5 分ごとの Cron が取る）ので DB を読むだけ。
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createDbClient();
  const now = new Date();
  const sims = await db
    .select({ id: eventSimulators.id, name: eventSimulators.name, targetRank: eventSimulators.targetRank })
    .from(eventSimulators)
    .where(and(eq(eventSimulators.userId, user.id), eq(eventSimulators.status, "active"), isNotNull(eventSimulators.rankingType), lte(eventSimulators.startTime, now), gte(eventSimulators.endTime, now)));

  const events: Array<{ simulatorId: string; name: string; status: RankStatus }> = [];
  for (const sim of sims) {
    const [latest, prev] = await db
      .select({ capturedAt: rankingSnapshots.capturedAt, myRank: rankingSnapshots.myRank, myPoint: rankingSnapshots.myPoint, entries: rankingSnapshots.entries })
      .from(rankingSnapshots)
      .where(eq(rankingSnapshots.simulatorId, sim.id))
      .orderBy(desc(rankingSnapshots.capturedAt))
      .limit(2);
    if (!latest) continue;
    const status = computeRankStatus(latest, prev ?? null, sim.targetRank);
    if (status) events.push({ simulatorId: sim.id, name: sim.name, status });
  }

  const res = NextResponse.json({ events });
  res.headers.set("Cache-Control", "private, max-age=30");
  return res;
}
