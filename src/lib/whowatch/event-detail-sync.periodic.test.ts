import { beforeEach, describe, expect, it, vi } from "vitest";

// WGP・N-1 の詳細同期（2026-10-07）: 構造 JSON を取りに行かず固定の struct を保存する・期間は開催月（WGP）/ 今月（N-1）
const { getEventDetailMock, getRulesMock, getInitMock, getStructMock } = vi.hoisted(() => ({
  getEventDetailMock: vi.fn(),
  getRulesMock: vi.fn(),
  getInitMock: vi.fn(),
  getStructMock: vi.fn(),
}));
vi.mock("./events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./events")>();
  return {
    ...actual,
    getEventDetail: getEventDetailMock,
    // /event_lists には WGP も N-1 も started_at / ended_at が無い（2026-10-07 実測）
    getEventLists: vi.fn(async () => ({
      open: [
        { id: 1531, eventKey: "2026_10_whowatchgrandprix", bannerUrl: "", status: "open", badgeText: null, canEntry: null, participants: null, startedAt: null, endedAt: null },
        { id: 31, eventKey: "nice_one_ranking", bannerUrl: "", status: "open", badgeText: null, canEntry: null, participants: null, startedAt: null, endedAt: null },
      ],
      pre: [],
      closed: [],
    })),
    getRankingStruct: getStructMock,
    getLimitedItemRankingsInit: getInitMock,
    getRules: getRulesMock,
  };
});

import { shapeEventDetail, syncEventDetail, viewFromRow } from "./event-detail-sync";
import { jstMonthWindowAt, N1_STRUCT_KEY, WGP_STRUCT_KEY } from "./periodic-ranking";

function fakeDb() {
  const updateSets: Record<string, unknown>[] = [];
  const inserted: Record<string, unknown>[] = [];
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    insert: () => ({ values: (v: Record<string, unknown>) => ({ onConflictDoUpdate: async () => void inserted.push(v) }) }),
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => void updateSets.push(v) }) }),
  };
  return { db: db as unknown as Parameters<typeof syncEventDetail>[0], updateSets, inserted };
}

describe("syncEventDetail（WGP）", () => {
  beforeEach(() => {
    getEventDetailMock.mockReset();
    getRulesMock.mockReset();
    getInitMock.mockReset();
    getStructMock.mockReset();
    getEventDetailMock.mockResolvedValue({
      eventKey: "2026_10_whowatchgrandprix",
      name: "WhoWatch GRAND PRIX",
      shortName: "WhoWatch GRAND PRIX",
      tabs: [
        { title: "概要", type: "NOTIFICATION", detail: "2350039" },
        { title: "投票券当選者", type: "NOTIFICATION", detail: "2350040" },
        { title: "ランキング", type: "WGP_RANKING", detail: "" },
      ],
      rankingPrefix: "wgp",
      itemGroupKey: null,
      notificationIds: ["2350039", "2350040"],
    });
    getRulesMock.mockResolvedValue({ id: "2350039", title: "【WGP】ふわっちグランプリ開催！(10月)", html: "<p>x</p>", text: "投票期間 2026年10月1日（木） ～ 2026年10月31日（土）", eventKey: "2026_10_whowatchgrandprix", publishedAt: null });
  });

  it("構造 JSON は取りに行かず {wgp: {開催月}} を struct に保存。期間は 10/1 0:00 〜 10/31 24:00 JST、kind は long、選択肢はデイリーと月間総合", async () => {
    const { db, inserted, updateSets } = fakeDb();
    const v = await syncEventDetail(db, "2026_10_whowatchgrandprix");
    expect(getStructMock).not.toHaveBeenCalled();
    expect(getInitMock).not.toHaveBeenCalled();
    expect(v.struct).toEqual({ [WGP_STRUCT_KEY]: { eventKey: "2026_10_whowatchgrandprix", month: "202610" } });
    expect(v.kind).toBe("long");
    expect(v.startedAt?.toISOString()).toBe("2026-09-30T15:00:00.000Z");
    // ended_at の慣例（23:59:59 JST）。+1 秒で 11/1 0:00 JST
    expect(v.endedAt?.toISOString()).toBe("2026-10-31T14:59:59.000Z");
    expect(v.periods).toEqual([]);
    expect(v.note).toBeNull();
    const shaped = shapeEventDetail(v);
    expect(shaped.endTime).toBe("2026-10-31T15:00:00.000Z");
    expect(shaped.rankingChoices.map((c) => c.rankingType)).toEqual(["wgp-daily", "wgp-overall"]);
    expect(inserted[0]).toMatchObject({ id: 1531, kind: "long", rankingPrefix: "wgp", startedAt: new Date("2026-09-30T15:00:00.000Z") });
    expect(updateSets[0]).toEqual({ struct: { [WGP_STRUCT_KEY]: { eventKey: "2026_10_whowatchgrandprix", month: "202610" } } });
  });

  it("DB の日付が無くても（一覧同期の NULL 上書き）event_key の開催月から補う。選択肢は struct が無くても出る", () => {
    const row = {
      id: 1531,
      eventKey: "2026_10_whowatchgrandprix",
      name: "WhoWatch GRAND PRIX",
      titleJa: null,
      shortName: "WhoWatch GRAND PRIX",
      status: "open",
      startedAt: null,
      endedAt: null,
      kind: "long",
      rankingPrefix: "wgp",
      struct: null,
      rulesText: null,
      rulesHtml: null,
      rulesParsed: null,
      periods: [],
      detailFetchedAt: new Date("2026-10-07T00:10:00.000Z"),
      bannerUrl: "",
      badgeText: null,
      badgeColor: null,
      badgeAnimation: false,
      participants: null,
      itemGroupKey: "",
      lastSyncedAt: new Date("2026-10-07T00:00:00.000Z"),
    } as unknown as Parameters<typeof viewFromRow>[0];
    const v = viewFromRow(row);
    expect(v.startedAt?.toISOString()).toBe("2026-09-30T15:00:00.000Z");
    expect(v.endedAt?.toISOString()).toBe("2026-10-31T14:59:59.000Z");
    expect(shapeEventDetail(v).rankingChoices.map((c) => c.rankingType)).toEqual(["wgp-daily", "wgp-overall"]);
  });
});

describe("syncEventDetail（N-1 グランプリ・常設）", () => {
  beforeEach(() => {
    getEventDetailMock.mockReset();
    getRulesMock.mockReset();
    getStructMock.mockReset();
    getEventDetailMock.mockResolvedValue({
      eventKey: "nice_one_ranking",
      name: "N-1 グランプリ",
      shortName: "N-1 グランプリ",
      tabs: [
        { title: "概要", type: "NOTIFICATION", detail: "2350067" },
        { title: "ランキング", type: "RANKING", detail: "n1" },
      ],
      rankingPrefix: "n1",
      itemGroupKey: null,
      notificationIds: ["2350067"],
    });
    getRulesMock.mockResolvedValue({ id: "2350067", title: "Nice数上位者に大量ポイントをプレゼント！【10月度 N-1グランプリ】", html: "<p>x</p>", text: "期間別ランキング（計3回）", eventKey: null, publishedAt: null });
  });

  it("構造 JSON（Z-002）は取りに行かず {n1: {}} を struct に保存。期間は今月（1 日 0:00 〜 月末 24:00 JST）、選択肢は 4 部門", async () => {
    const { db, inserted, updateSets } = fakeDb();
    const v = await syncEventDetail(db, "nice_one_ranking");
    expect(getStructMock).not.toHaveBeenCalled();
    expect(v.struct).toEqual({ [N1_STRUCT_KEY]: { eventKey: "nice_one_ranking" } });
    const month = jstMonthWindowAt(new Date());
    expect(v.startedAt?.getTime()).toBe(month.start.getTime());
    expect(v.endedAt?.getTime()).toBe(month.end.getTime() - 1000);
    expect(v.kind).toBe("long");
    expect(v.note).toBeNull();
    expect(shapeEventDetail(v).rankingChoices.map((c) => c.rankingType)).toEqual(["n1-male", "n1-female", "n1-rookie", "n1-total"]);
    expect(inserted[0]).toMatchObject({ id: 31, rankingPrefix: "n1" });
    expect(updateSets[0]).toEqual({ struct: { [N1_STRUCT_KEY]: { eventKey: "nice_one_ranking" } } });
  });
});
