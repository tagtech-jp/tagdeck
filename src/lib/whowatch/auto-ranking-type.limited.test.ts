import { beforeEach, describe, expect, it, vi } from "vitest";

// 期間限定アイテム型（limited-item・黄金発掘隊）のグループ自動判定（2026-10-07 社長指示「カテゴリーごとに自動的に入れて」）
const getRankingsMock = vi.fn();
vi.mock("./rankings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./rankings")>();
  return { ...actual, getRankings: (...args: unknown[]) => getRankingsMock(...args) };
});
vi.mock("./event-detail-sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./event-detail-sync")>();
  return { ...actual, syncEventDetail: vi.fn() };
});
// 公開プロフィール（publisher_id 用の数値 ID・性別）は取れない前提。取れる場合は auto-ranking-type.periodic.test.ts
vi.mock("./profile", () => ({ getPublicProfile: vi.fn(async () => null) }));

import { eventSimulators, streamerProfiles, whowatchEvents } from "@/lib/db/schema";
import { AUTO_LIMITED_SCAN_MAX_PER_RUN, autoAssignRankingTypes, decideLimitedItemRankingType } from "./auto-ranking-type";
import { LIMITED_ITEM_STRUCT_KEY, normalizeLimitedItemInit } from "./limited-item";
import type { RankingEntryApi } from "./rankings";

const INIT = {
  period: "20261007",
  select_boxes: [{ key: "20261007", value: "1日目", border: [{ rank: 5 }], tab_type: "daily" }],
  tabs: {
    daily: [
      { tab_name: "K24", group_id: "1" },
      { tab_name: "K20", group_id: "2" },
      { tab_name: "K18", group_id: "3" },
      { tab_name: "K14", group_id: "4" },
      { tab_name: "K10", group_id: "5" },
    ],
    overall: [{ tab_name: "総合ランキング", group_id: "1" }],
  },
  event_unit: "kg",
  is_overall_exists: true,
};
const PREFIX = "limited-item-2026_10_gold_digger_1";
const ME = "t:kuroppi1022";
// 10/7 12:00 JST。シミュレーターは 10/7 00:00 〜 10/8 00:00 JST
const NOW = new Date("2026-10-07T03:00:00.000Z");
const SIM = { id: "sim-gold", startTime: new Date("2026-10-06T15:00:00.000Z"), endTime: new Date("2026-10-07T15:00:00.000Z"), whowatchEventId: 1542, userId: "user-1", myEntryName: null as string | null };

const entry = (userPath: string, rank: number): RankingEntryApi => ({ rank, point: 100 * rank, userId: null, userPath, name: userPath, totalViewCount: null });
/** グループ別の順位表（種別の末尾のグループ番号で分ける） */
function rankingsByGroup(groupsWithMe: number[]) {
  return async (type: string) => {
    const g = Number(type.split("-").pop());
    const entries = [entry("w:other1", 1), entry("w:other2", 2)];
    if (groupsWithMe.includes(g)) entries.push(entry(ME, 3));
    return { rankingType: `${type}-20261007`, title: "", status: null, entries, fetchedAt: NOW.toISOString() };
  };
}

type Row = Record<string, unknown>;
function eventRow(over: Row = {}): Row {
  return {
    id: 1542,
    eventKey: "2026_10_gold_digger_1",
    name: "ふわっち黄金発掘隊",
    titleJa: null,
    shortName: "ふわっち黄金発掘隊",
    status: "open",
    startedAt: SIM.startTime,
    endedAt: new Date("2026-10-11T14:59:59.000Z"),
    kind: "daily",
    rankingPrefix: PREFIX,
    struct: { [LIMITED_ITEM_STRUCT_KEY]: INIT },
    rulesText: null,
    rulesHtml: null,
    rulesParsed: null,
    periods: [],
    detailFetchedAt: new Date("2026-10-07T00:10:00.000Z"),
    ...over,
  };
}

function fakeDb(sims: Row[], events: Row[], whowatchUserId: string | null) {
  const updates: Row[] = [];
  const profileReads = vi.fn(async () => (whowatchUserId === undefined ? [] : [{ whowatchUserId }]));
  const db = {
    select: () => ({
      from: (table: unknown) => {
        if (table === eventSimulators) {
          const chain = { innerJoin: () => chain, where: () => chain, orderBy: () => chain, limit: async () => sims };
          return chain;
        }
        if (table === streamerProfiles) return { where: () => ({ limit: profileReads }) };
        expect(table).toBe(whowatchEvents);
        return { where: async () => events };
      },
    }),
    update: () => ({
      set: (v: Row) => ({
        where: () => ({
          returning: async () => {
            updates.push(v);
            return [{ id: sims[updates.length - 1]?.id }];
          },
        }),
      }),
    }),
  };
  return { db: db as unknown as Parameters<typeof autoAssignRankingTypes>[0], updates, profileReads };
}

describe("autoAssignRankingTypes（期間限定アイテム型のグループ判定）", () => {
  beforeEach(() => {
    getRankingsMock.mockReset();
  });

  it("本人が K20（グループ 2）の今日の順位表に載っていれば limited-item-…-2 を入れ、見つかった時点で探すのをやめる", async () => {
    getRankingsMock.mockImplementation(rankingsByGroup([2]));
    const { db, updates } = fakeDb([SIM], [eventRow()], ME);
    const r = await autoAssignRankingTypes(db, NOW);
    expect(r.assigned).toEqual([{ id: SIM.id, rankingType: `${PREFIX}-2` }]);
    expect(r.skipped).toEqual([]);
    expect(updates).toEqual([{ rankingType: `${PREFIX}-2`, updatedAt: NOW }]);
    expect(getRankingsMock).toHaveBeenCalledTimes(2);
    // 日付はシミュレーターの期間に収めて決める（now と window を渡す）
    expect(getRankingsMock).toHaveBeenNthCalledWith(1, `${PREFIX}-1`, { limit: 100, now: NOW, window: { start: SIM.startTime, end: SIM.endTime } });
  });

  it("どのグループにも載っていなければ入れずに理由を返す（既定を K24 にしない）", async () => {
    getRankingsMock.mockImplementation(rankingsByGroup([]));
    const { db, updates } = fakeDb([SIM], [eventRow()], ME);
    const r = await autoAssignRankingTypes(db, NOW);
    expect(r.assigned).toEqual([]);
    expect(r.skipped).toEqual([{ id: SIM.id, reason: "今日のランキングにまだ載っていない（載った時点でグループを自動設定）" }]);
    expect(updates).toEqual([]);
    expect(getRankingsMock).toHaveBeenCalledTimes(5);
  });

  it("ふわっち ID も表示名も無ければ判定できない（順位表は取りに行かない）", async () => {
    getRankingsMock.mockImplementation(rankingsByGroup([2]));
    const { db } = fakeDb([SIM], [eventRow()], null);
    const r = await autoAssignRankingTypes(db, NOW);
    expect(r.skipped[0].reason).toContain("ふわっち ID が未設定");
    expect(getRankingsMock).not.toHaveBeenCalled();
  });

  it("表示名だけでも判定できる", async () => {
    getRankingsMock.mockImplementation(rankingsByGroup([4]));
    const { db } = fakeDb([{ ...SIM, myEntryName: ME }], [eventRow()], null);
    const r = await autoAssignRankingTypes(db, NOW);
    expect(r.assigned).toEqual([{ id: SIM.id, rankingType: `${PREFIX}-4` }]);
  });

  it("順位表の取得に失敗したグループは空扱いで次へ進む", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getRankingsMock.mockImplementation(async (type: string) => {
      if (type.endsWith("-1")) throw new Error("HTTP 502");
      return rankingsByGroup([2])(type);
    });
    const { db } = fakeDb([SIM], [eventRow()], ME);
    const r = await autoAssignRankingTypes(db, NOW);
    expect(r.assigned).toEqual([{ id: SIM.id, rankingType: `${PREFIX}-2` }]);
    warn.mockRestore();
  });

  it("グループ判定は 1 回の同期で上限件数まで。超えた分は次回に回す", async () => {
    expect(AUTO_LIMITED_SCAN_MAX_PER_RUN).toBe(2);
    getRankingsMock.mockImplementation(rankingsByGroup([2]));
    const sims = [SIM, { ...SIM, id: "sim-2" }, { ...SIM, id: "sim-3" }];
    const { db } = fakeDb(sims, [eventRow()], ME);
    const r = await autoAssignRankingTypes(db, NOW);
    expect(r.assigned.map((a) => a.id)).toEqual([SIM.id, "sim-2"]);
    expect(r.skipped).toEqual([{ id: "sim-3", reason: "今回のグループ判定の上限（次回の同期で判定）" }]);
  });

  it("初期化 JSON が無い（構造が取れていない）ときは従来どおり理由を返す", async () => {
    const { db } = fakeDb([SIM], [eventRow({ struct: null })], ME);
    const r = await autoAssignRankingTypes(db, NOW);
    expect(r.skipped).toEqual([{ id: SIM.id, reason: "区分の構造がまだ取れていない" }]);
    expect(getRankingsMock).not.toHaveBeenCalled();
  });
});

describe("decideLimitedItemRankingType", () => {
  it("グループが無く総合だけのイベントは総合を入れる", async () => {
    const init = normalizeLimitedItemInit({ tabs: { overall: [{ tab_name: "総合", group_id: "1" }] }, is_overall_exists: true })!;
    const d = await decideLimitedItemRankingType({ ...SIM, whowatchUserId: ME }, PREFIX, init, async () => []);
    expect(d).toEqual({ id: SIM.id, rankingType: `${PREFIX}-overall`, optionKey: "overall" });
  });
});
