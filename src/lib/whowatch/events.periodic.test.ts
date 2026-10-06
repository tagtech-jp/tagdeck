import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearEventApiCache, flattenRankingChoices, getEventDetail } from "./events";
import { N1_STRUCT_KEY, WGP_STRUCT_KEY } from "./periodic-ranking";

// 2026-10-07 実応答（GET /event_lists/2026_10_whowatchgrandprix・GET /event_lists/nice_one_ranking）
const WGP_DETAIL = {
  tabs: [
    { title: "概要", type: "NOTIFICATION", detail: "2350039" },
    { title: "投票券当選者", type: "NOTIFICATION", detail: "2350040" },
    { title: "ランキング", type: "WGP_RANKING", detail: "" },
  ],
  event_key: "2026_10_whowatchgrandprix",
  name: "WhoWatch GRAND PRIX",
  short_name: "WhoWatch GRAND PRIX",
};
const N1_DETAIL = {
  tabs: [
    { title: "概要", type: "NOTIFICATION", detail: "2350067" },
    { title: "ランキング", type: "RANKING", detail: "n1" },
  ],
  event_key: "nice_one_ranking",
  name: "N-1 グランプリ",
  short_name: "N-1 グランプリ",
};

describe("getEventDetail（WGP・N-1）", () => {
  let originalFetch: typeof global.fetch;
  beforeEach(() => {
    originalFetch = global.fetch;
    clearEventApiCache();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("WGP_RANKING タブ（detail 空）は擬似 prefix 'wgp' にする。通知は 2 件", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify(WGP_DETAIL), { status: 200 })) as unknown as typeof fetch;
    const d = await getEventDetail("2026_10_whowatchgrandprix");
    expect(d.rankingPrefix).toBe("wgp");
    expect(d.itemGroupKey).toBeNull();
    expect(d.notificationIds).toEqual(["2350039", "2350040"]);
    expect(d.name).toBe("WhoWatch GRAND PRIX");
  });

  it("2026-09 の形（detail '202609overall'）でも 'wgp'", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ ...WGP_DETAIL, event_key: "2026_09_whowatchgrandprix", tabs: [{ title: "ランキング", type: "WGP_RANKING", detail: "202609overall" }] }), { status: 200 })) as unknown as typeof fetch;
    const d = await getEventDetail("2026_09_whowatchgrandprix");
    expect(d.rankingPrefix).toBe("wgp");
  });

  it("N-1 は RANKING タブの detail 'n1' をそのまま prefix にする", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify(N1_DETAIL), { status: 200 })) as unknown as typeof fetch;
    const d = await getEventDetail("nice_one_ranking");
    expect(d.rankingPrefix).toBe("n1");
    expect(d.notificationIds).toEqual(["2350067"]);
  });

  it("RANKING タブも WGP_RANKING タブも無ければ従来どおり null", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ ...N1_DETAIL, tabs: [{ title: "概要", type: "NOTIFICATION", detail: "1" }] }), { status: 200 })) as unknown as typeof fetch;
    const d = await getEventDetail("x");
    expect(d.rankingPrefix).toBeNull();
  });
});

describe("flattenRankingChoices（WGP・N-1 は選択肢が固定）", () => {
  it("WGP はデイリーと月間総合。struct が無くても返す（作成フォームで即選べる）", () => {
    expect(flattenRankingChoices("wgp", null).map((c) => c.rankingType)).toEqual(["wgp-daily", "wgp-overall"]);
    expect(flattenRankingChoices("wgp", { [WGP_STRUCT_KEY]: { eventKey: "2026_10_whowatchgrandprix", month: "202610" } }).map((c) => c.parts)).toEqual([["daily"], ["overall"]]);
  });

  it("N-1 は男性・女性・ルーキー・全期間", () => {
    const choices = flattenRankingChoices("n1", { [N1_STRUCT_KEY]: { eventKey: "nice_one_ranking" } });
    expect(choices.map((c) => c.rankingType)).toEqual(["n1-male", "n1-female", "n1-rookie", "n1-total"]);
    expect(choices[0]).toMatchObject({ label: "男性部門", parts: ["male"], border: [{ rank: 10 }] });
  });

  it("従来の構造 JSON と期間限定アイテム型はこれまでどおり", () => {
    expect(flattenRankingChoices("wolfcoming", { selectboxes: [{ key: "overall", value: "総合" }] }).map((c) => c.rankingType)).toEqual(["wolfcoming_overall"]);
    expect(flattenRankingChoices("limited-item-2026_10_gold_digger_1", null)).toEqual([]);
  });
});
