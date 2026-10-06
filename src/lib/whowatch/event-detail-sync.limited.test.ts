import { beforeEach, describe, expect, it, vi } from "vitest";

// 期間限定アイテム型（limited-item・黄金発掘隊）の詳細同期（2026-10-07）:
//   構造 JSON の代わりに初期化 JSON を struct に包む・kind は daily・全体期間は概要の日程から
const { INIT, getEventDetailMock, getRulesMock, getInitMock, getStructMock } = vi.hoisted(() => ({
  INIT: {
    period: "20261007",
    select_boxes: [{ key: "20261007", value: "1日目", border: [{ rank: 5 }], tab_type: "daily" }],
    tabs: {
      daily: [
        { tab_name: "K24", group_id: "1" },
        { tab_name: "K20", group_id: "2" },
      ],
      overall: [{ tab_name: "総合ランキング", group_id: "1" }],
    },
    event_unit: "kg",
    is_overall_exists: true,
  },
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
    // /event_lists の日付（ここではイベントの公開日 10/6 00:00 JST）は使わず、概要の日程（ランキング 1 日目 10/7）を優先する。
    // 2026-10-07 本番で作成フォームの開始が 10/6 00:00 になった実害
    getEventLists: vi.fn(async () => ({
      open: [{ id: 1542, eventKey: "2026_10_gold_digger_1", bannerUrl: "", status: "open", badgeText: null, canEntry: null, participants: null, startedAt: Date.parse("2026-10-05T15:00:00.000Z"), endedAt: null }],
      pre: [],
      closed: [],
    })),
    getRankingStruct: getStructMock,
    getLimitedItemRankingsInit: getInitMock,
    getRules: getRulesMock,
  };
});

import { shapeEventDetail, syncEventDetail } from "./event-detail-sync";
import { WhowatchEventApiError } from "./events";
import { LIMITED_ITEM_STRUCT_KEY } from "./limited-item";

const RULES_TEXT = [
  "## ビッグな黄金を掘り当てろ！【ふわっち黄金発掘隊】",
  "イベントスケジュール",
  "ランキング（1日目）",
  "2026年10月7日（水） 00:00 〜 24:00",
  "ランキング（2日目）",
  "2026年10月8日（木） 00:00 〜 24:00",
  "ランキング（5日目）",
  "2026年10月11日（日） 00:00 〜 24:00",
  "グループ分け",
  "配信者グレードごとに K24・K20・K18・K14・K10 のグループに分かれて競います。",
].join("\n");

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

describe("syncEventDetail（期間限定アイテム型）", () => {
  beforeEach(() => {
    getEventDetailMock.mockReset();
    getRulesMock.mockReset();
    getInitMock.mockReset();
    getStructMock.mockReset();
    getEventDetailMock.mockResolvedValue({
      eventKey: "2026_10_gold_digger_1",
      name: "ふわっち黄金発掘隊",
      shortName: "ふわっち黄金発掘隊",
      tabs: [
        { title: "概要", type: "NOTIFICATION", detail: "2359109" },
        { title: "ランキング", type: "RANKING", detail: "limited-item-2026_10_gold_digger_1" },
        { title: "アイテム", type: "ITEM", detail: "gold_digger" },
      ],
      rankingPrefix: "limited-item-2026_10_gold_digger_1",
      itemGroupKey: "gold_digger",
      notificationIds: ["2359109"],
    });
    getRulesMock.mockResolvedValue({ id: "2359109", title: "ビッグな黄金を掘り当てろ！【ふわっち黄金発掘隊】", html: "<p>x</p>", text: RULES_TEXT, eventKey: "2026_10_gold_digger_1", publishedAt: null });
  });

  it("初期化 JSON を struct に包み、kind は daily、全体期間は概要の日程（1 日目 0:00 〜 5 日目 24:00 JST）", async () => {
    getInitMock.mockResolvedValue(INIT);
    const { db, inserted, updateSets } = fakeDb();
    const v = await syncEventDetail(db, "2026_10_gold_digger_1");
    expect(getStructMock).not.toHaveBeenCalled();
    expect(getInitMock).toHaveBeenCalledWith("2026_10_gold_digger_1");
    expect(v.struct).toEqual({ [LIMITED_ITEM_STRUCT_KEY]: INIT });
    expect(v.kind).toBe("daily");
    expect(v.startedAt?.toISOString()).toBe("2026-10-06T15:00:00.000Z");
    // ended_at の慣例（23:59:59 JST）に合わせ、+1 秒で翌 0:00 JST になる
    expect(v.endedAt?.toISOString()).toBe("2026-10-11T14:59:59.000Z");
    expect(v.periods).toEqual([]);
    expect(v.note).toBeNull();
    const shaped = shapeEventDetail(v);
    expect(shaped.endTime).toBe("2026-10-11T15:00:00.000Z");
    expect(shaped.rankingChoices.map((c) => c.rankingType)).toEqual([
      "limited-item-2026_10_gold_digger_1-1",
      "limited-item-2026_10_gold_digger_1-2",
      "limited-item-2026_10_gold_digger_1-overall",
    ]);
    // 小さい列（kind・日付）は upsert、struct は別 UPDATE で保存される
    expect(inserted[0]).toMatchObject({ id: 1542, kind: "daily", rankingPrefix: "limited-item-2026_10_gold_digger_1" });
    expect(updateSets[0]).toEqual({ struct: { [LIMITED_ITEM_STRUCT_KEY]: INIT } });
  });

  it("初期化 JSON が未公開（404）なら区分なしとして続け、理由を note に残す", async () => {
    getInitMock.mockRejectedValue(new WhowatchEventApiError(404, "Z-002"));
    const { db } = fakeDb();
    const v = await syncEventDetail(db, "2026_10_gold_digger_1");
    expect(v.struct).toBeNull();
    expect(v.note).toContain("未公開");
    expect(shapeEventDetail(v).rankingChoices).toEqual([]);
  });

  it("初期化 JSON の取得が 404 以外で失敗したら同期自体を失敗にする（struct 段階）", async () => {
    getInitMock.mockRejectedValue(new WhowatchEventApiError(503, "HTTP 503"));
    const { db } = fakeDb();
    await expect(syncEventDetail(db, "2026_10_gold_digger_1")).rejects.toThrow(/\[struct\]/);
  });
});
