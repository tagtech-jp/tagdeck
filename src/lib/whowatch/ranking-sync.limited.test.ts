import { beforeEach, describe, expect, it, vi } from "vitest";

// 期間限定アイテム型（limited-item・黄金発掘隊）の 5 分同期: 日付つきの種別で記録し、本人が居るグループへ付け替える（2026-10-07）
const getRankingsMock = vi.fn();
vi.mock("./rankings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./rankings")>();
  return { ...actual, getRankings: (...args: unknown[]) => getRankingsMock(...args) };
});

import { eventSimulators, streamerProfiles, whowatchEvents } from "@/lib/db/schema";
import { LIMITED_ITEM_STRUCT_KEY, resolveLimitedItemRankingType } from "./limited-item";
import { syncSimulatorRanking } from "./ranking-sync";
import type { RankingEntryApi } from "./rankings";

const INIT = {
  tabs: {
    daily: [
      { tab_name: "K24", group_id: "1" },
      { tab_name: "K20", group_id: "2" },
      { tab_name: "K18", group_id: "3" },
    ],
    overall: [{ tab_name: "総合ランキング", group_id: "1" }],
  },
  is_overall_exists: true,
};
const PREFIX = "limited-item-2026_10_gold_digger_1";
const ME = "t:kuroppi1022";
const NOW = new Date("2026-10-07T03:00:00.000Z");
const DAY1 = { start: new Date("2026-10-06T15:00:00.000Z"), end: new Date("2026-10-07T15:00:00.000Z") };

const entry = (userPath: string, rank: number): RankingEntryApi => ({ rank, point: 1000 - rank * 100, userId: null, userPath, name: userPath, totalViewCount: null });
function rankingsByGroup(groupsWithMe: number[], emptyAll = false) {
  return async (type: string, opts: { now: Date; window: { start: Date; end: Date } }) => {
    const g = Number(type.split("-").pop());
    const entries = emptyAll ? [] : [entry("w:other1", 1), entry("w:other2", 2)];
    if (!emptyAll && groupsWithMe.includes(g)) entries.push(entry(ME, 3));
    return { rankingType: resolveLimitedItemRankingType(type, opts.now, opts.window), title: "", status: null, entries, fetchedAt: NOW.toISOString() };
  };
}

type Row = Record<string, unknown>;
function simRow(over: Row = {}) {
  return {
    id: "sim-gold",
    userId: "user-1",
    name: "ふわっち黄金発掘隊",
    platform: "whowatch",
    eventType: "ranking",
    rankingType: `${PREFIX}-2`,
    whowatchEventId: 1542,
    myEntryName: null,
    eventRankingUrl: null,
    targetRank: 3,
    startTime: DAY1.start,
    endTime: DAY1.end,
    status: "active",
    currentScore: 0,
    currentRank: null,
    paceHistory: [],
    rivalsHistory: [],
    rivalsSnapshot: null,
    ...over,
  } as unknown as Parameters<typeof syncSimulatorRanking>[1];
}

function fakeDb(whowatchUserId: string | null, struct: unknown) {
  const updates: Row[] = [];
  const inserts: Row[] = [];
  const db = {
    select: () => ({
      from: (table: unknown) => {
        if (table === streamerProfiles) return { where: () => ({ limit: async () => [{ whowatchUserId }] }) };
        expect(table).toBe(whowatchEvents);
        return { where: () => ({ limit: async () => [{ struct }] }) };
      },
    }),
    update: (table: unknown) => {
      expect(table).toBe(eventSimulators);
      return { set: (v: Row) => ({ where: async () => void updates.push(v) }) };
    },
    insert: () => ({ values: (v: Row) => ({ returning: async () => (inserts.push(v), [{ id: "snap-1" }]) }) }),
  };
  return { db: db as unknown as Parameters<typeof syncSimulatorRanking>[0], updates, inserts };
}

describe("syncSimulatorRanking（期間限定アイテム型）", () => {
  beforeEach(() => {
    getRankingsMock.mockReset();
  });

  it("日付なしの種別で取得を頼み、スナップショットには日付つきの種別で記録する", async () => {
    getRankingsMock.mockImplementation(rankingsByGroup([2]));
    const { db, updates, inserts } = fakeDb(ME, { [LIMITED_ITEM_STRUCT_KEY]: INIT });
    const r = await syncSimulatorRanking(db, simRow(), { now: NOW });
    expect(getRankingsMock).toHaveBeenCalledTimes(1);
    expect(getRankingsMock).toHaveBeenCalledWith(`${PREFIX}-2`, { limit: 100, now: NOW, window: DAY1 });
    expect(r.myEntry).toMatchObject({ rank: 3 });
    expect(r.switchedRankingType).toBeUndefined();
    expect(inserts[0]).toMatchObject({ rankingType: `${PREFIX}-2-20261007`, myRank: 3 });
    // event_simulators の更新は 1 回（順位・ペース）。区分の付け替えは無い
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ currentRank: 3 });
  });

  it("本人が今日の順位表に居なければ他のグループを探し、居たグループへ ranking_type を付け替える（グレード判定が変わる日がある）", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    getRankingsMock.mockImplementation(rankingsByGroup([3]));
    const { db, updates, inserts } = fakeDb(ME, { [LIMITED_ITEM_STRUCT_KEY]: INIT });
    const r = await syncSimulatorRanking(db, simRow(), { now: NOW });
    expect(r.switchedRankingType).toBe(`${PREFIX}-3`);
    expect(r.myEntry).toMatchObject({ rank: 3 });
    // 付け替え（1 回目）→ 順位の更新（2 回目）
    expect(updates[0]).toMatchObject({ rankingType: `${PREFIX}-3`, updatedAt: NOW });
    expect(inserts[0]).toMatchObject({ rankingType: `${PREFIX}-3-20261007` });
    // グループ 2（今の種別）→ 1 → 3 の順に見て、3 で見つかった
    expect(getRankingsMock.mock.calls.map((c) => c[0])).toEqual([`${PREFIX}-2`, `${PREFIX}-1`, `${PREFIX}-3`]);
    log.mockRestore();
  });

  it("どのグループにも居なければ付け替えず、今のグループの順位表をそのまま記録する", async () => {
    getRankingsMock.mockImplementation(rankingsByGroup([]));
    const { db, updates, inserts } = fakeDb(ME, { [LIMITED_ITEM_STRUCT_KEY]: INIT });
    const r = await syncSimulatorRanking(db, simRow(), { now: NOW });
    expect(r.switchedRankingType).toBeUndefined();
    expect(r.myEntry).toBeNull();
    expect(updates).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ rankingType: `${PREFIX}-2-20261007`, myRank: null });
  });

  it("今日の順位表に誰も居なければ、デイリーの切り替わりを説明した文で返す（保存はしない）", async () => {
    getRankingsMock.mockImplementation(rankingsByGroup([], true));
    const { db, updates, inserts } = fakeDb(ME, { [LIMITED_ITEM_STRUCT_KEY]: INIT });
    const r = await syncSimulatorRanking(db, simRow(), { now: NOW });
    expect(r.snapshotId).toBeNull();
    expect(r.message).toContain("0:00");
    expect(updates).toEqual([]);
    expect(inserts).toEqual([]);
  });

  it("総合ランキングの種別は付け替えの対象外", async () => {
    getRankingsMock.mockImplementation(async (type: string, opts: { now: Date; window: { start: Date; end: Date } }) => ({
      rankingType: resolveLimitedItemRankingType(type, opts.now, opts.window),
      title: "",
      status: null,
      entries: [entry("w:other1", 1)],
      fetchedAt: NOW.toISOString(),
    }));
    const { db } = fakeDb(ME, { [LIMITED_ITEM_STRUCT_KEY]: INIT });
    const r = await syncSimulatorRanking(db, simRow({ rankingType: `${PREFIX}-overall` }), { now: NOW });
    expect(getRankingsMock).toHaveBeenCalledTimes(1);
    expect(r.switchedRankingType).toBeUndefined();
  });
});
