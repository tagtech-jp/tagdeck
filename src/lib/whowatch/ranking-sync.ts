// ランキング同期の共通処理（E2）: refresh-ranking ルート / poll ルート / 5 分 cron から呼ばれる。
//   1) ranking_type があれば公開 API（/rankings/{type}）で取得。無ければ旧スクレイプ（fetchEventRanking）にフォールバック
//   2) 自分を特定し、ライバルを自動選定（目標順位の前後 + 直上）
//   3) event_simulators を更新（currentRank/currentScore/paceHistory/rivalsSnapshot/rivalsHistory）
//   4) ranking_snapshots に 1 行追記（append-only）

import { eq } from "drizzle-orm";
import type { createDbClient } from "@/lib/db/client";
import { eventSimulators, rankingSnapshots, streamerProfiles } from "@/lib/db/schema";
import { fetchEventRanking, extractRivals, type RankingEntry } from "@/lib/platforms/whowatch-ranking";
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
 * 1 シミュレーターのランキングを取得して保存する。取得失敗時は例外を投げる（呼び出し側で握る）。
 * @param opts.now 取得時刻（テスト用）
 */
export async function syncSimulatorRanking(db: DbOrTx, event: SimulatorRow, opts: { now?: Date } = {}): Promise<RankingSyncResult> {
  const now = opts.now ?? new Date();

  let apiResult: RankingResult | null = null;
  let entries: RankingEntry[] = [];
  let apiEntries: RankingEntryApi[] = [];
  let source: RankingSyncResult["source"] = "none";

  if (event.rankingType) {
    apiResult = await getRankings(event.rankingType, { limit: 100 });
    apiEntries = apiResult.entries;
    entries = apiEntries.map(toLegacy);
    source = "api";
  } else if (event.eventRankingUrl) {
    entries = await fetchEventRanking(event.eventRankingUrl);
    source = "scrape";
  }

  if (entries.length === 0) {
    return { source, myEntry: null, rivals: [], snapshotId: null, status: apiResult?.status ?? null, message: "ランキングデータが取得できませんでした。手動入力をご利用ください。" };
  }

  // ── 自分の特定とライバル選定 ──
  let myEntry: RankingEntry | null = null;
  let rivals: RankingEntry[] = [];
  if (source === "api") {
    const whowatchUserId = await loadWhowatchUserId(db, event.userId);
    const me = findMyEntry(apiEntries, { whowatchUserId, myEntryName: event.myEntryName });
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

  // ── ranking_snapshots 追記（生データ保持）──
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
  };
}
