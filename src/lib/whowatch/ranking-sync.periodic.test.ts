import { beforeEach, describe, expect, it, vi } from "vitest";

// WGP・N-1 の 5 分同期（2026-10-07）: 期間つきの種別で記録し、N-1 は本人が居る部門へ付け替える。WGP は付け替えない
const getRankingsMock = vi.fn();
vi.mock("./rankings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./rankings")>();
  return { ...actual, getRankings: (...args: unknown[]) => getRankingsMock(...args) };
});

import { eventSimulators, streamerProfiles, whowatchEvents } from "@/lib/db/schema";
import { resolvePeriodicRankingType } from "./periodic-ranking";
import { syncSimulatorRanking } from "./ranking-sync";
import type { RankingEntryApi } from "./rankings";

const ME = "t:kuroppi1022";
/** 2026-10-07 12:00 JST */
const NOW = new Date("2026-10-07T03:00:00.000Z");
const ROUND1 = { start: new Date("2026-09-30T15:00:00.000Z"), end: new Date("2026-10-10T15:00:00.000Z") };
const DAY7 = { start: new Date("2026-10-06T15:00:00.000Z"), end: new Date("2026-10-07T15:00:00.000Z") };

const entry = (userPath: string, rank: number): RankingEntryApi => ({ rank, point: 1000 - rank * 100, userId: null, userPath, name: userPath, totalViewCount: null });
/** 種別の区分（n1-{division} / wgp-{division}）で分けた順位表 */
function rankingsByDivision(divisionsWithMe: string[], emptyAll = false) {
  return async (type: string, opts: { now: Date; window: { start: Date; end: Date } }) => {
    const division = type.split("-")[1];
    const entries = emptyAll ? [] : [entry("w:other1", 1), entry("w:other2", 2)];
    if (!emptyAll && divisionsWithMe.includes(division)) entries.push(entry(ME, 3));
    return { rankingType: resolvePeriodicRankingType(type, opts.now, opts.window), title: "", status: 1, entries, fetchedAt: NOW.toISOString() };
  };
}

type Row = Record<string, unknown>;
function simRow(over: Row = {}) {
  return {
    id: "sim-n1",
    userId: "user-1",
    name: "N-1 グランプリ",
    platform: "whowatch",
    eventType: "ranking",
    rankingType: "n1-male",
    whowatchEventId: 31,
    myEntryName: null,
    eventRankingUrl: null,
    targetRank: 3,
    startTime: ROUND1.start,
    endTime: ROUND1.end,
    status: "active",
    currentScore: 0,
    currentRank: null,
    paceHistory: [],
    rivalsHistory: [],
    rivalsSnapshot: null,
    ...over,
  } as unknown as Parameters<typeof syncSimulatorRanking>[1];
}

function fakeDb(whowatchUserId: string | null) {
  const updates: Row[] = [];
  const inserts: Row[] = [];
  const eventReads = vi.fn(async () => [{ struct: null }]);
  const db = {
    select: () => ({
      from: (table: unknown) => {
        if (table === streamerProfiles) return { where: () => ({ limit: async () => [{ whowatchUserId }] }) };
        expect(table).toBe(whowatchEvents);
        return { where: () => ({ limit: eventReads }) };
      },
    }),
    update: (table: unknown) => {
      expect(table).toBe(eventSimulators);
      return { set: (v: Row) => ({ where: async () => void updates.push(v) }) };
    },
    insert: () => ({ values: (v: Row) => ({ returning: async () => (inserts.push(v), [{ id: "snap-1" }]) }) }),
  };
  return { db: db as unknown as Parameters<typeof syncSimulatorRanking>[0], updates, inserts, eventReads };
}

describe("syncSimulatorRanking（N-1 グランプリ）", () => {
  beforeEach(() => {
    getRankingsMock.mockReset();
  });

  it("期間なしの種別で取得を頼み、スナップショットには回つきの種別（n1-male-202610-1st）で記録する", async () => {
    getRankingsMock.mockImplementation(rankingsByDivision(["male"]));
    const { db, updates, inserts, eventReads } = fakeDb(ME);
    const r = await syncSimulatorRanking(db, simRow(), { now: NOW });
    expect(getRankingsMock).toHaveBeenCalledTimes(1);
    expect(getRankingsMock).toHaveBeenCalledWith("n1-male", { limit: 100, now: NOW, window: ROUND1 });
    expect(r.myEntry).toMatchObject({ rank: 3 });
    expect(r.switchedRankingType).toBeUndefined();
    expect(inserts[0]).toMatchObject({ rankingType: "n1-male-202610-1st", myRank: 3 });
    expect(updates).toHaveLength(1);
    // 部門は固定なので whowatch_events.struct は読まない
    expect(eventReads).not.toHaveBeenCalled();
  });

  it("本人が今の回の男性部門に居なければ女性・ルーキーを探し、居た部門へ ranking_type を付け替える", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    getRankingsMock.mockImplementation(rankingsByDivision(["rookie"]));
    const { db, updates, inserts } = fakeDb(ME);
    const r = await syncSimulatorRanking(db, simRow(), { now: NOW });
    expect(r.switchedRankingType).toBe("n1-rookie");
    expect(r.myEntry).toMatchObject({ rank: 3 });
    expect(updates[0]).toMatchObject({ rankingType: "n1-rookie", updatedAt: NOW });
    expect(inserts[0]).toMatchObject({ rankingType: "n1-rookie-202610-1st" });
    expect(getRankingsMock.mock.calls.map((c) => c[0])).toEqual(["n1-male", "n1-female", "n1-rookie"]);
    log.mockRestore();
  });

  it("どの部門にも居なければ付け替えず、今の部門の順位表をそのまま記録する", async () => {
    getRankingsMock.mockImplementation(rankingsByDivision([]));
    const { db, updates, inserts } = fakeDb(ME);
    const r = await syncSimulatorRanking(db, simRow(), { now: NOW });
    expect(r.switchedRankingType).toBeUndefined();
    expect(r.myEntry).toBeNull();
    expect(updates).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ rankingType: "n1-male-202610-1st", myRank: null });
  });

  it("全期間（n1-total）は付け替えの対象外。空なら月間であることを説明する", async () => {
    getRankingsMock.mockImplementation(rankingsByDivision([], true));
    const { db } = fakeDb(ME);
    const r = await syncSimulatorRanking(db, simRow({ rankingType: "n1-total", startTime: new Date("2026-09-30T15:00:00.000Z"), endTime: new Date("2026-10-31T15:00:00.000Z") }), { now: NOW });
    expect(getRankingsMock).toHaveBeenCalledTimes(1);
    expect(r.snapshotId).toBeNull();
    expect(r.message).toContain("全期間");
  });

  it("今の回の順位表に誰も居なければ、回の切り替わり（1 日・11 日・21 日）を説明した文で返す（保存はしない）", async () => {
    getRankingsMock.mockImplementation(rankingsByDivision([], true));
    const { db, updates, inserts } = fakeDb(ME);
    const r = await syncSimulatorRanking(db, simRow(), { now: NOW });
    expect(r.snapshotId).toBeNull();
    expect(r.message).toContain("11 日");
    expect(updates).toEqual([]);
    expect(inserts).toEqual([]);
  });
});

describe("syncSimulatorRanking（WGP）", () => {
  beforeEach(() => {
    getRankingsMock.mockReset();
  });

  it("デイリーは日付つきの種別（wgp-daily-20261007）で記録し、本人が居なくても付け替えない（区分は属性で決まらない）", async () => {
    getRankingsMock.mockImplementation(rankingsByDivision([]));
    const { db, inserts } = fakeDb(ME);
    const r = await syncSimulatorRanking(db, simRow({ id: "sim-wgp", rankingType: "wgp-daily", whowatchEventId: 1531, startTime: DAY7.start, endTime: DAY7.end }), { now: NOW });
    expect(getRankingsMock).toHaveBeenCalledTimes(1);
    expect(getRankingsMock).toHaveBeenCalledWith("wgp-daily", { limit: 100, now: NOW, window: DAY7 });
    expect(r.switchedRankingType).toBeUndefined();
    expect(r.myEntry).toBeNull();
    expect(inserts[0]).toMatchObject({ rankingType: "wgp-daily-20261007", myRank: null });
  });

  it("月間総合が空（21 日より前）なら公開日を説明する", async () => {
    getRankingsMock.mockImplementation(rankingsByDivision([], true));
    const { db } = fakeDb(ME);
    const r = await syncSimulatorRanking(db, simRow({ id: "sim-wgp", rankingType: "wgp-overall", whowatchEventId: 1531, startTime: new Date("2026-09-30T15:00:00.000Z"), endTime: new Date("2026-10-31T15:00:00.000Z") }), { now: NOW });
    expect(r.snapshotId).toBeNull();
    expect(r.message).toContain("21 日");
  });

  it("デイリーが空なら 0:00 の切り替わりを説明する", async () => {
    getRankingsMock.mockImplementation(rankingsByDivision([], true));
    const { db } = fakeDb(ME);
    const r = await syncSimulatorRanking(db, simRow({ id: "sim-wgp", rankingType: "wgp-daily", whowatchEventId: 1531, startTime: DAY7.start, endTime: DAY7.end }), { now: NOW });
    expect(r.message).toContain("0:00");
    expect(r.message).toContain("WGP");
  });
});
