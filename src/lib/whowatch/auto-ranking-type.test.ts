import { beforeEach, describe, expect, it, vi } from "vitest";

const syncEventDetailMock = vi.fn();
vi.mock("./event-detail-sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./event-detail-sync")>();
  return { ...actual, syncEventDetail: (...args: unknown[]) => syncEventDetailMock(...args) };
});

import { eventSimulators, whowatchEvents } from "@/lib/db/schema";
import { AUTO_REPAIR_MAX_PER_RUN, autoAssignRankingTypes, decideRankingType, needsDetailRepair, pickRepairTargets, type AssignDetail } from "./auto-ranking-type";
import type { RankingStruct } from "./events";

// 2026_10_magicfantasy の縮約（前半は総合とぬいぐるみ、後半は総合）
const STRUCT: RankingStruct = {
  options: [
    { key: "1st", value: "前半", selectboxes: [{ key: "overall", value: "前半総合" }, { key: "doll", value: "ぬいぐるみ", chips: [{ key: "free", value: "フリー" }] }] },
    { key: "2nd", value: "後半", selectboxes: [{ key: "overall", value: "後半総合" }] },
  ],
};
const PERIODS = [
  { option_key: "1st", label: "前半", starts_at: "2026-09-30T15:00:00.000Z", ends_at: "2026-10-06T15:00:00.000Z", source: "rules" as const },
  { option_key: "2nd", label: "後半", starts_at: "2026-10-06T15:00:00.000Z", ends_at: "2026-10-12T15:00:00.000Z", source: "rules" as const },
];
const START_1ST = new Date("2026-09-30T15:00:00.000Z");
const SIM = { id: "49a163c8-0000-4000-8000-000000000000", startTime: START_1ST, whowatchEventId: 1523 };
const detail = (over: Partial<AssignDetail> = {}): AssignDetail => ({ rankingPrefix: "magicfantasy", struct: STRUCT, periods: PERIODS, fetched: true, ...over });

describe("decideRankingType / needsDetailRepair", () => {
  it("開始日時を含む区分の総合を返す", () => {
    expect(decideRankingType(SIM, detail())).toEqual({ id: SIM.id, rankingType: "magicfantasy_1st_overall", optionKey: "1st" });
    expect(decideRankingType({ ...SIM, startTime: new Date("2026-10-07T00:00:00.000Z") }, detail())).toMatchObject({ rankingType: "magicfantasy_2nd_overall" });
  });

  it("入れられないときは理由を返す", () => {
    expect(decideRankingType(SIM, null)).toEqual({ id: SIM.id, skip: "イベントの詳細が未取得" });
    expect(decideRankingType(SIM, detail({ rankingPrefix: null, struct: null, fetched: false }))).toMatchObject({ skip: "イベントの詳細が未取得" });
    expect(decideRankingType(SIM, detail({ rankingPrefix: null, struct: null }))).toMatchObject({ skip: "このイベントにはランキング区分が無い" });
    expect(decideRankingType(SIM, detail({ struct: null }))).toMatchObject({ skip: "区分の構造がまだ取れていない" });
    expect(decideRankingType(SIM, detail({ struct: { error_code: "Z-002", error_message: "データが見つかりません" } }))).toMatchObject({ skip: "区分の構造がまだ取れていない" });
    expect(decideRankingType(SIM, detail({ struct: {} }))).toMatchObject({ skip: "区分の選択肢が 0 件" });
  });

  it("取り直すのは「未取得」と「RANKING タブがあるのに構造が使えない」だけ（RANKING タブ無しは取り直さない）", () => {
    expect(needsDetailRepair(detail({ rankingPrefix: null, struct: null, fetched: false }))).toBe(true);
    expect(needsDetailRepair(detail({ struct: null }))).toBe(true);
    expect(needsDetailRepair(detail({ struct: { error_code: "Z-002" } }))).toBe(true);
    expect(needsDetailRepair(detail())).toBe(false);
    expect(needsDetailRepair(detail({ rankingPrefix: null, struct: null }))).toBe(false);
  });
});

type Row = Record<string, unknown>;

function eventRow(over: Row = {}): Row {
  return {
    id: 1523,
    eventKey: "2026_10_magicfantasy",
    name: "ふわっちマジックファンタジーワールド",
    titleJa: null,
    shortName: "マジックファンタジー",
    status: "open",
    startedAt: START_1ST,
    endedAt: new Date("2026-10-12T14:59:59.000Z"),
    kind: "long",
    rankingPrefix: "magicfantasy",
    struct: STRUCT,
    rulesText: null,
    rulesHtml: null,
    rulesParsed: null,
    periods: PERIODS,
    detailFetchedAt: new Date("2026-09-30T19:46:41.000Z"),
    ...over,
  };
}

/** drizzle の呼び出しの形だけ真似た DB。updates に UPDATE の set 値を残す */
function fakeDb(sims: Row[], events: Row[], opts: { alreadySet?: string[] } = {}) {
  const updates: Row[] = [];
  const eventReads = vi.fn(async () => events);
  const db = {
    select: () => ({
      from: (table: unknown) => {
        if (table === eventSimulators) {
          const chain = { innerJoin: () => chain, where: () => chain, orderBy: () => chain, limit: async () => sims };
          return chain;
        }
        expect(table).toBe(whowatchEvents);
        return { where: eventReads };
      },
    }),
    update: (table: unknown) => {
      expect(table).toBe(eventSimulators);
      return {
        set: (v: Row) => ({
          where: () => ({
            returning: async () => {
              const id = sims[updates.length]?.id as string | undefined;
              updates.push(v);
              return id && opts.alreadySet?.includes(id) ? [] : [{ id }];
            },
          }),
        }),
      };
    },
  };
  return { db: db as unknown as Parameters<typeof autoAssignRankingTypes>[0], updates, eventReads };
}

describe("autoAssignRankingTypes", () => {
  const NOW = new Date("2026-10-01T03:00:00.000Z");
  beforeEach(() => {
    syncEventDetailMock.mockReset();
  });

  it("構造が保存済みなら取り直さずに総合を入れる（更新日時も入れる）", async () => {
    const { db, updates } = fakeDb([SIM], [eventRow()]);
    const r = await autoAssignRankingTypes(db, NOW);
    expect(r).toEqual({ assigned: [{ id: SIM.id, rankingType: "magicfantasy_1st_overall" }], repaired: [], skipped: [] });
    expect(updates).toEqual([{ rankingType: "magicfantasy_1st_overall", updatedAt: NOW }]);
    expect(syncEventDetailMock).not.toHaveBeenCalled();
  });

  it("構造が保存されていなければ取り直してから入れる（2026_10_magicfantasy の実害）", async () => {
    syncEventDetailMock.mockResolvedValue({ eventKey: "2026_10_magicfantasy", rankingPrefix: "magicfantasy", struct: STRUCT, periods: PERIODS, source: "api" });
    const { db, updates } = fakeDb([SIM], [eventRow({ struct: null })]);
    const r = await autoAssignRankingTypes(db, NOW);
    expect(syncEventDetailMock).toHaveBeenCalledWith(db, "2026_10_magicfantasy");
    expect(r.repaired).toEqual(["2026_10_magicfantasy"]);
    expect(r.assigned).toEqual([{ id: SIM.id, rankingType: "magicfantasy_1st_overall" }]);
    expect(updates).toHaveLength(1);
  });

  it("取り直しに失敗したら区分は入れずに理由を返す", async () => {
    syncEventDetailMock.mockRejectedValue(new Error("whowatch API 503"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db, updates } = fakeDb([SIM], [eventRow({ struct: null })]);
    const r = await autoAssignRankingTypes(db, NOW);
    expect(r).toEqual({ assigned: [], repaired: [], skipped: [{ id: SIM.id, reason: "区分の構造がまだ取れていない" }] });
    expect(updates).toEqual([]);
    warn.mockRestore();
  });

  it("取り直しは 1 回の同期で 1 イベントまで。同じイベントの 2 件目は取り直した構造を使う", async () => {
    expect(AUTO_REPAIR_MAX_PER_RUN).toBe(1);
    syncEventDetailMock.mockResolvedValue({ eventKey: "2026_10_magicfantasy", rankingPrefix: "magicfantasy", struct: STRUCT, periods: PERIODS, source: "api" });
    const sims = [SIM, { ...SIM, id: "sim-same-event" }, { ...SIM, id: "sim-other-event", whowatchEventId: 1530 }];
    const { db } = fakeDb(sims, [eventRow({ struct: null }), eventRow({ id: 1530, eventKey: "2026_10_other", rankingPrefix: "other", struct: null })]);
    const r = await autoAssignRankingTypes(db, NOW);
    expect(syncEventDetailMock).toHaveBeenCalledTimes(1);
    expect(r.assigned.map((a) => a.id)).toEqual([SIM.id, "sim-same-event"]);
    expect(r.skipped).toEqual([{ id: "sim-other-event", reason: "区分の構造がまだ取れていない" }]);
  });

  it("DB のまま返った（10 分以内に取り直し済み）ときは repaired に数えない", async () => {
    syncEventDetailMock.mockResolvedValue({ eventKey: "2026_10_magicfantasy", rankingPrefix: "magicfantasy", struct: null, periods: PERIODS, source: "db" });
    const { db } = fakeDb([SIM], [eventRow({ struct: null })]);
    const r = await autoAssignRankingTypes(db, NOW);
    expect(r.repaired).toEqual([]);
    expect(r.skipped).toEqual([{ id: SIM.id, reason: "区分の構造がまだ取れていない" }]);
  });

  it("利用者がその間に区分を選んでいたら（更新 0 行）assigned に入れない", async () => {
    const { db, updates } = fakeDb([SIM], [eventRow()], { alreadySet: [SIM.id] });
    const r = await autoAssignRankingTypes(db, NOW);
    expect(updates).toHaveLength(1);
    expect(r.assigned).toEqual([]);
  });

  it("10 分以内に取り直したばかりのイベントは syncEventDetail を呼ばない（API を叩かない）", async () => {
    const { db } = fakeDb([SIM], [eventRow({ struct: null, detailFetchedAt: new Date(NOW.getTime() - 5 * 60 * 1000) })]);
    const r = await autoAssignRankingTypes(db, NOW);
    expect(syncEventDetailMock).not.toHaveBeenCalled();
    expect(r.skipped).toEqual([{ id: SIM.id, reason: "区分の構造がまだ取れていない" }]);
  });

  it("取り直すのは取得が最も古いイベント（未取得が先）。構造がずっと取れないイベントが枠を使い続けない", async () => {
    syncEventDetailMock.mockResolvedValue({ eventKey: "2026_10_magicfantasy", rankingPrefix: "magicfantasy", struct: STRUCT, periods: PERIODS, source: "api" });
    // 先に始まったシミュレーターのイベント（1530）は 1 時間前に取り直したが構造が取れていない。1523 は未取得
    const sims = [{ ...SIM, id: "sim-stuck", whowatchEventId: 1530, startTime: new Date("2026-09-30T00:00:00.000Z") }, SIM];
    const events = [
      eventRow({ id: 1530, eventKey: "2026_10_stuck", rankingPrefix: "stuck", struct: null, detailFetchedAt: new Date(NOW.getTime() - 60 * 60 * 1000) }),
      eventRow({ rankingPrefix: null, struct: null, periods: null, detailFetchedAt: null }),
    ];
    const { db } = fakeDb(sims, events);
    const r = await autoAssignRankingTypes(db, NOW);
    expect(syncEventDetailMock).toHaveBeenCalledTimes(1);
    expect(syncEventDetailMock).toHaveBeenCalledWith(db, "2026_10_magicfantasy");
    expect(r.skipped).toEqual([{ id: "sim-stuck", reason: "区分の構造がまだ取れていない" }]);
    expect(r.assigned).toEqual([{ id: SIM.id, rankingType: "magicfantasy_1st_overall" }]);
  });

  it("取り直しの失敗ログに SQL 全文・params を出さない", async () => {
    syncEventDetailMock.mockRejectedValue(new Error('Failed query: select "id" from "whowatch_events" where "event_key" = $1\nparams: 2026_10_magicfantasy'));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db } = fakeDb([SIM], [eventRow({ struct: null })]);
    await autoAssignRankingTypes(db, NOW);
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls[0].map(String).join(" ");
    expect(logged).toContain("2026_10_magicfantasy");
    expect(logged).toContain("Failed query");
    expect(logged).not.toContain("select");
    expect(logged).not.toContain("params");
    warn.mockRestore();
  });

  it("対象が無ければイベントを読まない", async () => {
    const { db, eventReads } = fakeDb([], [eventRow()]);
    expect(await autoAssignRankingTypes(db, NOW)).toEqual({ assigned: [], repaired: [], skipped: [] });
    expect(eventReads).not.toHaveBeenCalled();
  });
});

describe("pickRepairTargets", () => {
  const NOW_MS = Date.parse("2026-10-01T03:00:00.000Z");
  const entry = (name: string, fetchedMinAgo: number | null, over: Partial<AssignDetail> = {}) => ({
    name,
    row: { detailFetchedAt: fetchedMinAgo === null ? null : new Date(NOW_MS - fetchedMinAgo * 60 * 1000), rankingPrefix: "rankingPrefix" in over ? (over.rankingPrefix ?? null) : "x", struct: (over.struct ?? null) as Record<string, unknown> | null },
    detail: detail({ rankingPrefix: "x", struct: null, fetched: fetchedMinAgo !== null, ...over }),
  });

  it("欠けていて 10 分以上前に取ったものだけを、取得が古い順（未取得が先）に max 件", () => {
    const list = [entry("60分前", 60), entry("5分前", 5), entry("未取得", null, { rankingPrefix: null }), entry("30分前", 30), entry("構造あり", 600, { struct: { options: [] } })];
    expect(pickRepairTargets(list, NOW_MS, 10).map((e) => e.name)).toEqual(["未取得", "60分前", "30分前"]);
    expect(pickRepairTargets(list, NOW_MS).map((e) => e.name)).toEqual(["未取得"]);
    expect(pickRepairTargets(list, NOW_MS, 0)).toEqual([]);
  });
});
