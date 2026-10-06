import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearEventApiCache, flattenRankingChoices, getLimitedItemRankingsInit, WhowatchEventApiError } from "./events";
import { LIMITED_ITEM_STRUCT_KEY } from "./limited-item";

// 2026-10-07 実応答（/events/limited_item_rankings_init?event_key=2026_10_gold_digger_1）の縮約
const INIT = {
  period: "20261007",
  select_boxes: [
    { key: "OVERALL", value: "総合ランキング", border: [{ rank: 5 }], tab_type: "overall" },
    { key: "20261007", value: "1日目", border: [{ rank: 5 }], tab_type: "daily" },
  ],
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
  event_name: "ふわっち黄金発掘隊",
  event_unit: "kg",
  is_overall_exists: true,
};

describe("期間限定アイテム型（limited-item）の区分の選択肢", () => {
  it("struct に包んだ初期化 JSON から、グループ 5 件 + 総合 を日付なしの保存形で返す", () => {
    const choices = flattenRankingChoices("limited-item-2026_10_gold_digger_1", { [LIMITED_ITEM_STRUCT_KEY]: INIT });
    expect(choices.map((c) => c.rankingType)).toEqual([
      "limited-item-2026_10_gold_digger_1-1",
      "limited-item-2026_10_gold_digger_1-2",
      "limited-item-2026_10_gold_digger_1-3",
      "limited-item-2026_10_gold_digger_1-4",
      "limited-item-2026_10_gold_digger_1-5",
      "limited-item-2026_10_gold_digger_1-overall",
    ]);
    expect(choices[1]).toMatchObject({ label: "K20", parts: ["2"], border: [{ rank: 5 }] });
    expect(choices[5].label).toContain("総合");
  });

  it("従来の構造 JSON はこれまでどおり（limited_item キーが無い）", () => {
    const choices = flattenRankingChoices("wolfcoming", { selectboxes: [{ key: "overall", value: "総合" }] });
    expect(choices.map((c) => c.rankingType)).toEqual(["wolfcoming_overall"]);
  });
});

describe("getLimitedItemRankingsInit", () => {
  let originalFetch: typeof global.fetch;
  beforeEach(() => {
    originalFetch = global.fetch;
    clearEventApiCache();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("event_key をクエリで渡し、成功は 10 分キャッシュする", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe("https://api.whowatch.tv/events/limited_item_rankings_init?event_key=2026_10_gold_digger_1");
      return new Response(JSON.stringify(INIT), { status: 200 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const d = await getLimitedItemRankingsInit("2026_10_gold_digger_1");
    expect(d.event_unit).toBe("kg");
    await getLimitedItemRankingsInit("2026_10_gold_digger_1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("HTTP 200 の error_code（未公開・無いイベント）は 404 として投げ、キャッシュしない", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error_code: "Z-002", error_message: "データが見つかりません" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(INIT), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const err = await getLimitedItemRankingsInit("2026_10_gold_digger_1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WhowatchEventApiError);
    expect((err as WhowatchEventApiError).status).toBe(404);
    const d = await getLimitedItemRankingsInit("2026_10_gold_digger_1");
    expect(d.event_name).toBe("ふわっち黄金発掘隊");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
