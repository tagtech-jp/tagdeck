import { NextResponse } from "next/server";
import { and, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { eventItemPoints, eventSimulators, itemPointMapping, rankingSnapshots, whowatchEvents } from "@/lib/db/schema";
import { computeRankStatus, itemsNeeded, itemsNeededByDistribution, type ItemPointLite, type ItemsNeeded, type ItemsNeededStatsView, type RankStatus } from "@/lib/live/rank-alert";
import { distributionFromValueTable, type ItemValueDistribution } from "@/lib/events/item-stats";

type Db = ReturnType<typeof createDbClient>;

/**
 * GET /api/live/rank-status → 開催中の自分のイベント（ランキング区分あり）ごとの順位パネル用の値と警告（2026-10-05）。
 * ranking_snapshots の直近 2 枚から計算する。ランキングの取得はしない（5 分ごとの Cron が取る）ので DB を読むだけ。
 * 2026-10-06: 足りない pt を「アイテムあと◯個」に換算して付ける（イベント別の基礎 pt = event_item_points・当たり倍率の期待値 = rules_parsed）
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createDbClient();
  const now = new Date();
  const sims = await db
    .select({ id: eventSimulators.id, name: eventSimulators.name, targetRank: eventSimulators.targetRank, whowatchEventId: eventSimulators.whowatchEventId })
    .from(eventSimulators)
    .where(and(eq(eventSimulators.userId, user.id), eq(eventSimulators.status, "active"), isNotNull(eventSimulators.rankingType), lte(eventSimulators.startTime, now), gte(eventSimulators.endTime, now)));

  const events: Array<{
    simulatorId: string;
    name: string;
    status: RankStatus;
    itemsToTarget: ItemsNeeded[];
    itemsToAbove: ItemsNeeded[];
    /** ルール本文の表（重量表）からの統計。表が無いイベントは null（2026-10-07） */
    statsToTarget: ItemsNeededStatsView | null;
    statsToAbove: ItemsNeededStatsView | null;
  }> = [];
  for (const sim of sims) {
    const [latest, prev] = await db
      .select({ capturedAt: rankingSnapshots.capturedAt, myRank: rankingSnapshots.myRank, myPoint: rankingSnapshots.myPoint, entries: rankingSnapshots.entries, rankingType: rankingSnapshots.rankingType })
      .from(rankingSnapshots)
      .where(eq(rankingSnapshots.simulatorId, sim.id))
      .orderBy(desc(rankingSnapshots.capturedAt))
      .limit(2);
    if (!latest) continue;
    // 日替わりのランキング（limited-item・2026-10-07）は 0:00 を跨ぐと前回が前日の順位表になる。別の日の表とは比べない（抜かれた・目標割れの誤報防止）
    const prevComparable = prev && prev.rankingType === latest.rankingType ? prev : null;
    const status = computeRankStatus(latest, prevComparable, sim.targetRank);
    if (!status) continue;
    // 換算は付加情報。読めなくても順位パネルは返す
    let conv: Conversion = { items: [], multiplier: null, dist: null };
    try {
      if (sim.whowatchEventId !== null) conv = await loadConversion(db, sim.whowatchEventId);
    } catch (e) {
      console.warn("[live/rank-status] アイテム換算の取得に失敗（換算なしで返す）", e instanceof Error ? e.message : String(e));
    }
    // 1 つ上を「抜く」には同点では足りないので +1
    const gapToAbove = status.above ? status.above.gap + 1 : null;
    const gapToTarget = status.target && status.target.gap > 0 ? status.target.gap : null;
    events.push({
      simulatorId: sim.id,
      name: sim.name,
      status,
      itemsToTarget: status.target ? itemsNeeded(status.target.gap, conv.items, conv.multiplier) : [],
      itemsToAbove: gapToAbove !== null ? itemsNeeded(gapToAbove, conv.items, conv.multiplier) : [],
      // ルール本文の表（重量表）があれば、ばらつきを含めた「あと何個」（中央値・90%）。2026-10-07 社長指示「統計を駆使して現実的な解を」
      statsToTarget: gapToTarget !== null ? itemsNeededByDistribution(gapToTarget, conv.dist) : null,
      statsToAbove: gapToAbove !== null ? itemsNeededByDistribution(gapToAbove, conv.dist) : null,
    });
  }

  const res = NextResponse.json({ events });
  res.headers.set("Cache-Control", "private, max-age=30");
  return res;
}

interface Conversion {
  items: ItemPointLite[];
  multiplier: number | null;
  /** ルール本文の獲得量の表（重量表）から作った 1 個あたりの分布。無ければ null */
  dist: ItemValueDistribution | null;
}

/** イベントの基礎 pt（event_item_points）とアイテム名、ルールの当たり倍率の期待値、獲得量の表 */
async function loadConversion(db: Db, whowatchEventId: number): Promise<Conversion> {
  const [ev] = await db.select({ eventKey: whowatchEvents.eventKey, rulesParsed: whowatchEvents.rulesParsed }).from(whowatchEvents).where(eq(whowatchEvents.id, whowatchEventId)).limit(1);
  if (!ev) return { items: [], multiplier: null, dist: null };
  const m = ev.rulesParsed?.expectedMultiplier;
  const multiplier = typeof m === "number" && Number.isFinite(m) && m > 0 ? m : null;
  const vt = ev.rulesParsed?.valueTable;
  const dist = Array.isArray(vt)
    ? distributionFromValueTable(vt as Array<{ probability: number; min: number; max: number | null; label?: string | null }>, typeof ev.rulesParsed?.valueUnit === "string" ? ev.rulesParsed.valueUnit : null)
    : null;
  const points = await db.select({ itemId: eventItemPoints.itemId, basePoint: eventItemPoints.basePoint }).from(eventItemPoints).where(eq(eventItemPoints.eventKey, ev.eventKey));
  if (points.length === 0) return { items: [], multiplier, dist };
  const names = await db
    .select({ itemId: itemPointMapping.itemId, itemName: itemPointMapping.itemName })
    .from(itemPointMapping)
    .where(and(eq(itemPointMapping.platform, "whowatch"), inArray(itemPointMapping.itemId, points.map((p) => p.itemId))));
  const nameById = new Map(names.map((n) => [n.itemId, n.itemName]));
  return { items: points.map((p) => ({ name: nameById.get(p.itemId) ?? `アイテム #${p.itemId}`, basePoint: p.basePoint })), multiplier, dist };
}
