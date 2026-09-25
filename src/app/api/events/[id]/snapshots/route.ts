import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { eventSimulators, rankingSnapshots } from "@/lib/db/schema";

/**
 * GET /api/events/[id]/snapshots?limit=48 → 自分のシミュレーターの ranking_snapshots（新しい順）。E3 のクライアント計算用。
 * 既定 48 枚（5 分間隔で約 4 時間分）。最大 288 枚（24 時間分）。
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limitRaw = Number(new URL(request.url).searchParams.get("limit") ?? "48");
  const limit = Number.isFinite(limitRaw) ? Math.min(288, Math.max(1, Math.floor(limitRaw))) : 48;

  const db = createDbClient();
  const [ev] = await db
    .select({ id: eventSimulators.id })
    .from(eventSimulators)
    .where(and(eq(eventSimulators.id, id), eq(eventSimulators.userId, user.id)))
    .limit(1);
  if (!ev) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = await db
    .select()
    .from(rankingSnapshots)
    .where(eq(rankingSnapshots.simulatorId, id))
    .orderBy(desc(rankingSnapshots.capturedAt))
    .limit(limit);

  const res = NextResponse.json({
    snapshots: rows.map((r) => ({
      id: r.id,
      rankingType: r.rankingType,
      capturedAt: r.capturedAt.toISOString(),
      status: r.status,
      myRank: r.myRank,
      myPoint: r.myPoint,
      entries: r.entries,
    })),
  });
  res.headers.set("Cache-Control", "private, max-age=30");
  return res;
}
