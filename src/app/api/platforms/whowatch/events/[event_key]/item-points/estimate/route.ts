import { NextResponse } from "next/server";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { eventSimulators, events, rankingSnapshots, streamerProfiles } from "@/lib/db/schema";

const EVENT_KEY_RE = /^[a-z0-9_\-]{1,100}$/i;
const bodySchema = z.object({ simulatorId: z.string().uuid(), itemId: z.string().min(1).max(100) });

/**
 * POST /api/platforms/whowatch/events/{event_key}/item-points/estimate → 「実測から推定」
 *   自分のスナップショット間の my_point 増分 ÷ その間に使われた当該アイテム個数（events テーブルの gift 行）
 *   = 1 個あたりの実効 pt（当たり込みの平均）。保存はせず推定値を返す（保存は PUT item-points で source='estimated'）。
 *   gift 行は S1（ふわっちギフト保存）以降に溜まる。無い間は insufficient を返す。
 */
export async function POST(request: Request, { params }: { params: Promise<{ event_key: string }> }) {
  const { event_key: eventKey } = await params;
  if (!EVENT_KEY_RE.test(eventKey)) return NextResponse.json({ error: "invalid event_key" }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "simulatorId(uuid) と itemId が必要です" }, { status: 400 });
  const { simulatorId, itemId } = parsed.data;

  const db = createDbClient();
  const [sim] = await db
    .select({ id: eventSimulators.id })
    .from(eventSimulators)
    .where(and(eq(eventSimulators.id, simulatorId), eq(eventSimulators.userId, user.id)))
    .limit(1);
  if (!sim) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [profile] = await db
    .select({ id: streamerProfiles.id })
    .from(streamerProfiles)
    .where(eq(streamerProfiles.userId, user.id))
    .limit(1);

  const snaps = await db
    .select({ capturedAt: rankingSnapshots.capturedAt, myPoint: rankingSnapshots.myPoint })
    .from(rankingSnapshots)
    .where(eq(rankingSnapshots.simulatorId, simulatorId))
    .orderBy(asc(rankingSnapshots.capturedAt));
  const withPoint = snaps.filter((s) => s.myPoint !== null);
  if (withPoint.length < 2 || !profile) {
    return NextResponse.json({ ok: false, reason: "insufficient_snapshots", message: "自分の pt が入ったスナップショットが 2 枚以上必要です" });
  }

  const from = withPoint[0].capturedAt;
  const to = withPoint[withPoint.length - 1].capturedAt;
  const pointDelta = (withPoint[withPoint.length - 1].myPoint ?? 0) - (withPoint[0].myPoint ?? 0);

  // 期間内の当該アイテムのギフト個数（payload.item_id / payload.count は S1 の正規化形）
  const [agg] = await db
    .select({
      count: sql<number>`coalesce(sum(coalesce((${events.payload}->>'count')::int, 1)), 0)`,
    })
    .from(events)
    .where(
      and(
        eq(events.streamerId, profile.id),
        eq(events.platform, "whowatch"),
        eq(events.eventType, "gift"),
        sql`${events.payload}->>'item_id' = ${itemId}`,
        gte(events.occurredAt, from),
        lte(events.occurredAt, to),
      ),
    );
  const giftCount = Number(agg?.count ?? 0);
  if (giftCount <= 0 || pointDelta <= 0) {
    return NextResponse.json({
      ok: false,
      reason: "insufficient_gifts",
      message: "期間内にこのアイテムのギフト記録がありません（ギフト保存は S1 以降）",
      pointDelta,
      giftCount,
      from: from.toISOString(),
      to: to.toISOString(),
    });
  }
  const estimatedBasePoint = Math.round(pointDelta / giftCount);
  return NextResponse.json({ ok: true, estimatedBasePoint, pointDelta, giftCount, from: from.toISOString(), to: to.toISOString(), note: "他アイテムの pt も含まれるため上振れしうる（当たり込みの実効値）" });
}
