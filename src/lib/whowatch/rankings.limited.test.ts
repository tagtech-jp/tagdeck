import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRankings, normalizeLimitedItemRankingResponse, RANKING_TYPE_RE, WhowatchRankingApiError } from "./rankings";

// 2026-10-07 実応答（/events/limited_item_rankings?period=20261007&event_key=2026_10_gold_digger_1&group=2）の縮約・名前は仮名
const RESPONSE = {
  rankings: [
    { user_id: 72252879, user_name: "A", user_path: "w:a", icon_url: "", rank: 1, point: 6831.0, birthday_month: false, live_id: 1, is_push_registered: false, is_follow: false, can_follow: true },
    { user_id: 29812595, user_name: "B", user_path: "w:b", icon_url: "", rank: 2, point: 1686.0, live_id: 2 },
    { user_id: 74338319, user_name: "えるぴ", user_path: "t:kuroppi1022", icon_url: "", rank: 3, point: 1387.4, live_id: 3 },
  ],
};
// 10/7 00:00 JST 〜 10/8 00:00 JST
const DAY1 = { start: new Date("2026-10-06T15:00:00.000Z"), end: new Date("2026-10-07T15:00:00.000Z") };

describe("期間限定アイテム型のランキング（limited-item）", () => {
  it("ranking_type はハイフンを含んでよい（従来の形も通る）", () => {
    expect(RANKING_TYPE_RE.test("limited-item-2026_10_gold_digger_1-2-20261007")).toBe(true);
    expect(RANKING_TYPE_RE.test("autumncollection_1st_overall")).toBe(true);
    expect(RANKING_TYPE_RE.test("bad type!")).toBe(false);
  });

  it("応答を正規化する: user_name → name、point は整数に丸める、順位順", () => {
    const r = normalizeLimitedItemRankingResponse(RESPONSE, "limited-item-2026_10_gold_digger_1-2-20261007")!;
    expect(r.rankingType).toBe("limited-item-2026_10_gold_digger_1-2-20261007");
    expect(r.status).toBeNull();
    expect(r.entries).toHaveLength(3);
    expect(r.entries[0]).toMatchObject({ rank: 1, point: 6831, userId: "72252879", userPath: "w:a", name: "A", totalViewCount: null });
    expect(r.entries[2]).toMatchObject({ rank: 3, point: 1387, userPath: "t:kuroppi1022" });
    // error_code 付き（Z-001）と形違いは null
    expect(normalizeLimitedItemRankingResponse({ error_code: "Z-001", error_message: "ご利用いただけません" }, "x")).toBeNull();
    expect(normalizeLimitedItemRankingResponse([], "x")).toBeNull();
    expect(normalizeLimitedItemRankingResponse({ rankings: [] }, "x")?.entries).toEqual([]);
  });

  describe("getRankings の分岐", () => {
    let originalFetch: typeof global.fetch;
    beforeEach(() => {
      originalFetch = global.fetch;
    });
    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("日付なしの保存形は、期間に収めた今日の日付を付けて limited_item_rankings を叩く", async () => {
      const fetchMock = vi.fn(async (url: string | URL | Request) => {
        const u = new URL(String(url));
        expect(u.pathname).toBe("/events/limited_item_rankings");
        expect(u.searchParams.get("period")).toBe("20261007");
        expect(u.searchParams.get("event_key")).toBe("2026_10_gold_digger_1");
        expect(u.searchParams.get("group")).toBe("2");
        return new Response(JSON.stringify(RESPONSE), { status: 200 });
      });
      global.fetch = fetchMock as unknown as typeof fetch;
      // 10/8 05:00 JST でも期間が 10/7 の 1 日なら 10/7 の順位表
      const r = await getRankings("limited-item-2026_10_gold_digger_1-2", { now: new Date("2026-10-07T20:00:00.000Z"), window: DAY1 });
      expect(r.rankingType).toBe("limited-item-2026_10_gold_digger_1-2-20261007");
      expect(r.entries[0].point).toBe(6831);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("総合は period=OVERALL・group=1 で叩き、種別は -1-OVERALL", async () => {
      const fetchMock = vi.fn(async (url: string | URL | Request) => {
        const u = new URL(String(url));
        expect(u.searchParams.get("period")).toBe("OVERALL");
        expect(u.searchParams.get("group")).toBe("1");
        return new Response(JSON.stringify(RESPONSE), { status: 200 });
      });
      global.fetch = fetchMock as unknown as typeof fetch;
      const r = await getRankings("limited-item-2026_10_gold_digger_1-overall", { now: new Date("2026-10-07T03:00:00.000Z") });
      expect(r.rankingType).toBe("limited-item-2026_10_gold_digger_1-1-OVERALL");
    });

    it("Z-001（開始前の日付・無いグループ）は 404 の例外", async () => {
      global.fetch = vi.fn(async () => new Response(JSON.stringify({ error_code: "Z-001", error_message: "ご利用いただけません。運営までお問い合わせください(Z-001)" }), { status: 200 })) as unknown as typeof fetch;
      const err = await getRankings("limited-item-2026_10_gold_digger_1-9", { now: new Date("2026-10-07T03:00:00.000Z") }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WhowatchRankingApiError);
      expect((err as WhowatchRankingApiError).status).toBe(404);
      expect((err as Error).message).toContain("Z-001");
    });

    it("従来の種別はこれまでどおり /rankings/{type} を叩く", async () => {
      const fetchMock = vi.fn(async (url: string | URL | Request) => {
        expect(String(url)).toContain("/rankings/autumncollection_1st_overall?");
        return new Response(JSON.stringify([{ ranking_type: "AUTUMNCOLLECTION_1ST_OVERALL", status: 1, rankings: [{ user: { id: 1, user_path: "w:a", name: "A" }, rank: 1, point: 10 }] }]), { status: 200 });
      });
      global.fetch = fetchMock as unknown as typeof fetch;
      const r = await getRankings("autumncollection_1st_overall");
      expect(r.entries[0].point).toBe(10);
    });
  });
});
