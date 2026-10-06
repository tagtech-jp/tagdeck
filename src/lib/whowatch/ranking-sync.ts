// ランキング同期の共通処理（E2）: refresh-ranking ルート / poll ルート / 5 分 cron から呼ばれる。
//   1) ranking_type があれば公開 API（/rankings/{type}。期間限定アイテム型は /events/limited_item_rankings）で取得。無ければ旧スクレイプ（fetchEventRanking）にフォールバック
//   2) 自分を特定し、ライバルを自動選定（目標順位の前後 + 直上）
//   3) event_simulators を更新（currentRank/currentScore/paceHistory/rivalsSnapshot/rivalsHistory）
//   4) ranking_snapshots に 1 行追記（append-only）
// 2026-10-07: 期間限定アイテム型（limited-item・黄金発掘隊）のデイリーは毎日 0:00 JST に順位表が切り替わる。
//   ranking_type は日付なしで保存し、取得する時にその日の日付を付ける（limited-item.ts）。スナップショットには日付つきの種別を記録する。
//   自分が今日の順位表に居なければ、他のグループ（配信者グレード K24〜K10。毎日 0:00 の判定で変わりうる）を探して ranking_type を付け替える。

import { and, eq } from "drizzle-orm";
import type { createDbClient } from "@/lib/db/client";
import { eventSimulators, rankingSnapshots, streamerProfiles, whowatchEvents } from "@/lib/db/schema";
import { fetchEventRanking, extractRivals, type RankingEntry } from "@/lib/platforms/whowatch-ranking";
import { buildLimitedItemRankingType, limitedItemInitFromStruct, parseLimitedItemRankingType, type LimitedItemRankingType } from "./limited-item";
import { findMyEntry, getRankings, selectAutoRivals, type RankingEntryApi, type RankingResult } from "./rankings";

type Db = ReturnType<typeof createDbClient>;
// src/worker.ts の scheduled ハンドラは pg_try_advisory_xact_lock(トランザクション単位)で
// 多重起動を防ぐため db.transaction() のコールバック引数(tx)からこの関数を呼ぶ。
// select/update/insert...returning しか使わないため tx でも db でも動作は同じ。
type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
type SimulatorRow = typeof eventSimulators.$inferSelect;

export interface RankingSyncResult {
  source: "api" | "scrape" | "none";
  myEntry: { rank: number; name: string; score: number } | null;
  rivals: Array<{ rank: number; name: string; score: number }>;
  snapshotId: string | null;
  status: number | null;
  message?: string;
  /** 期間限定アイテム型で、自分が居るグループへ ranking_type を付け替えたとき（新しい保存形の種別） */
  switchedRankingType?: string;
}

const RIVALS_HISTORY_KEEP = 20;
const PACE_HISTORY_KEEP = 500;

/** API 結果を既存 UI の RankingEntry 形へ */
function toLegacy(e: RankingEntryApi): RankingEntry {
  return { rank: e.rank, name: e.name, username: e.userPath ?? undefined, score: e.point };
}

async function loadWhowatchUserId(db: DbOrTx, userId: string): Promise<string | null> {
  const [p] = await db
    .select({ whowatchUserId: streamerProfiles.whowatchUserId })
    .from(streamerProfiles)
    .where(eq(streamerProfiles.userId, userId))
    .limit(1);
  return p?.whowatchUserId ?? null;
}

/**
 * 期間限定アイテム型のデイリーで、自分が居るグループを探す（今の種別のグループ以外を順に見る）。
 * 見つかれば {種別, 取得結果, 自分}。グループの一覧は whowatch_events.struct（初期化 JSON）から。無ければ null
 */
async function findMyLimitedItemGroup(
  db: DbOrTx,
  event: SimulatorRow,
  li: LimitedItemRankingType,
  ctx: { now: Date; window: { start: Date; end: Date }; whowatchUserId: string | null },
): Promise<{ rankingType: string; result: RankingResult; me: RankingEntryApi } | null> {
  if (event.whowatchEventId === null) return null;
  const [row] = await db.select({ struct: whowatchEvents.struct }).from(whowatchEvents).where(eq(whowatchEvents.id, event.whowatchEventId)).limit(1);
  const init = limitedItemInitFromStruct(row?.struct ?? null);
  if (!init) return null;
  for (const g of init.groups) {
    if (g.id === li.group) continue;
    const type = buildLimitedItemRankingType(li.eventKey, g.id);
    try {
      const r = await getRankings(type, { limit: 100, now: ctx.now, window: ctx.window });
      const me = findMyEntry(r.entries, { whowatchUserId: ctx.whowatchUserId, myEntryName: event.myEntryName });
      if (me) return { rankingType: type, result: r, me };
    } catch (e) {
      console.warn("[ranking-sync] limited-item group lookup failed", type, e instanceof Error ? e.message : String(e));
    }
  }
  return null;
}

/**
 * 1 シミュレーターのランキングを取得して保存する。取得失敗時は例外を投げる（呼び出し側で握る）。
 * @param opts.now 取得時刻（テスト用）
 */
export async function syncSimulatorRanking(db: DbOrTx, event: SimulatorRow, opts: { now?: Date } = {}): Promise<RankingSyncResult> {
  const now = opts.now ?? new Date();
  // デイリーの日付はシミュレーターの期間に収めて決める（1 日だけの期間なら翌日になってもその日の順位表）
  const window = { start: event.startTime, end: event.endTime };

  let apiResult: RankingResult | null = null;
  let entries: RankingEntry[] = [];
  let apiEntries: RankingEntryApi[] = [];
  let source: RankingSyncResult["source"] = "none";
  let me: RankingEntryApi | null = null;
  let switchedRankingType: string | undefined;
  const limited = parseLimitedItemRankingType(event.rankingType);

  if (event.rankingType) {
    apiResult = await getRankings(event.rankingType, { limit: 100, now, window });
    apiEntries = apiResult.entries;
    source = "api";
    const whowatchUserId = await loadWhowatchUserId(db, event.userId);
    me = findMyEntry(apiEntries, { whowatchUserId, myEntryName: event.myEntryName });
    // 期間限定アイテム型のデイリー: 自分が今日の順位表に居なければ、他のグループ（配信者グレード）を探して付け替える
    if (!me && limited && limited.group !== "overall" && (whowatchUserId || event.myEntryName)) {
      const found = await findMyLimitedItemGroup(db, event, limited, { now, window, whowatchUserId });
      if (found) {
        apiResult = found.result;
        apiEntries = found.result.entries;
        me = found.me;
        switchedRankingType = found.rankingType;
        // 利用者がその間に別の区分を選んでいたら上書きしない（今の種別のままの行だけ）
        await db
          .update(eventSimulators)
          .set({ rankingType: found.rankingType, updatedAt: now })
          .where(and(eq(eventSimulators.id, event.id), eq(eventSimulators.rankingType, event.rankingType)));
        console.log(`[ranking-sync] limited-item group switched ${event.id.slice(0, 8)}: ${event.rankingType} -> ${found.rankingType}`);
      }
    }
    entries = apiEntries.map(toLegacy);
  } else if (event.eventRankingUrl) {
    entries = await fetchEventRanking(event.eventRankingUrl);
    source = "scrape";
  }

  if (entries.length === 0) {
    const message = limited
      ? "今日の順位表にはまだ誰も載っていません（デイリーは毎日 0:00 に切り替わります）。アイテムが使われると順位が出ます。"
      : "ランキングデータが取得できませんでした。手動入力をご利用ください。";
    return { source, myEntry: null, rivals: [], snapshotId: null, status: apiResult?.status ?? null, message, switchedRankingType };
  }

  // ── 自分の特定とライバル選定 ──
  let myEntry: RankingEntry | null = null;
  let rivals: RankingEntry[] = [];
  if (source === "api") {
    myEntry = me ? toLegacy(me) : null;
    const targetRank = event.targetRank ?? 1;
    rivals = selectAutoRivals(apiEntries, targetRank, me).map(toLegacy);
    // 目標周辺に誰もいない（ランキングが短い等）場合は従来の周辺抽出にフォールバック
    if (rivals.length === 0) rivals = extractRivals(entries, event.myEntryName ?? "", 3, 3).rivals;
  } else {
    const r = extractRivals(entries, event.myEntryName ?? "", 3, 3);
    myEntry = r.myEntry;
    rivals = r.rivals;
  }

  // ── event_simulators 更新（poll/refresh-ranking と同一ロジック）──
  const existingHistory = (event.rivalsHistory ?? []) as Array<{ timestamp: string; rivals: Array<{ rank: number; name: string; score: number }> }>;
  const existingPace = (event.paceHistory ?? []) as Array<{ timestamp: string; score: number }>;
  const lastPace = existingPace.at(-1);
  const shouldAppendPace = myEntry != null && (existingPace.length === 0 || myEntry.score !== lastPace?.score);
  const rivalsPlain = rivals.map((r) => ({ rank: r.rank, name: r.name, score: r.score }));

  await db
    .update(eventSimulators)
    .set({
      currentRank: myEntry?.rank ?? null,
      currentScore: myEntry?.score ?? event.currentScore,
      paceHistory: shouldAppendPace
        ? [...existingPace.slice(-(PACE_HISTORY_KEEP - 1)), { timestamp: now.toISOString(), score: myEntry!.score }]
        : existingPace,
      rivalsSnapshot: { timestamp: now.toISOString(), rivals: rivalsPlain },
      rivalsHistory: [...existingHistory.slice(-(RIVALS_HISTORY_KEEP - 1)), { timestamp: now.toISOString(), rivals: rivalsPlain }],
      updatedAt: now,
    })
    .where(eq(eventSimulators.id, event.id));

  // ── ranking_snapshots 追記（生データ保持。期間限定アイテム型は日付つきの種別で記録される）──
  let snapshotId: string | null = null;
  if (source === "api" && apiResult) {
    const [snap] = await db
      .insert(rankingSnapshots)
      .values({
        simulatorId: event.id,
        rankingType: apiResult.rankingType,
        capturedAt: now,
        status: apiResult.status,
        entries: apiEntries.map((e) => ({
          rank: e.rank,
          point: e.point,
          user_id: e.userId,
          user_path: e.userPath,
          name: e.name,
          total_view_count: e.totalViewCount,
        })),
        myRank: myEntry?.rank ?? null,
        myPoint: myEntry?.score ?? null,
      })
      .returning({ id: rankingSnapshots.id });
    snapshotId = snap?.id ?? null;
  }

  return {
    source,
    myEntry: myEntry ? { rank: myEntry.rank, name: myEntry.name, score: myEntry.score } : null,
    rivals: rivalsPlain,
    snapshotId,
    status: apiResult?.status ?? null,
    switchedRankingType,
  };
}
