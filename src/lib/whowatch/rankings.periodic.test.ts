import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getN1Rankings, getRankings, getWgpRankings, WhowatchRankingApiError } from "./rankings";

// 2026-10-07 実応答（GET /wgp/ranking/20261007）の縮約・名前は仮名
const WGP_DAILY = {
  title: "リアルタイム更新中",
  year: 2026,
  month: 10,
  day: 7,
  previous: 20261006,
  status: 1,
  icon_url: "",
  is_fixed: false,
  banners: [{ banner_url: "", state: "OPEN", available: true, state_open: true }],
  rankings: [
    { user: { id: 36838348, user_profile: {}, user_path: "w:koyuaking", icon_url: "", name: "A", can_follow: true, is_admin: false }, rank: 1, point: 1116, total_view_count: 0, live: { id: 76653168 } },
    { user: { id: 2865405, user_profile: {}, user_path: "w:renrenkajp", icon_url: "", name: "B", can_follow: true, is_admin: false }, rank: 2, point: 236, total_view_count: 0 },
    { user: { id: 74338319, user_profile: {}, user_path: "t:kuroppi1022", icon_url: "", name: "えるぴ", can_follow: true, is_admin: false }, rank: 3, point: 100, total_view_count: 0 },
  ],
};
// GET /wgp/ranking/overall/202610（21 日 0:00 までは rankings が空）
const WGP_OVERALL_EMPTY = { title: " ", year: 2026, month: 10, previous: 202609, status: 1, icon_url: "", is_fixed: false, banners: [], rankings: [] };
// GET /rankings/nice_one_1st_male/202610?detail=true の縮約
const N1_MALE = [
  {
    title: "リアルタイム更新中",
    name: "N-1グランプリ",
    short_name: "N-1グランプリ",
    status: 1,
    previous: "202609",
    latest: "202610",
    year_month: "2026年10月",
    period: "10月1日(木) 〜 10月10日(土)",
    ranking_type: "NICE_ONE_1ST_MALE",
    is_fixed: false,
    rankings: [
      { user: { id: 37787543, user_profile: {}, user_path: "w:seiz1234", icon_url: "", name: "C", can_follow: true, is_admin: false }, rank: 1, total_view_count: 0, point: 24439, is_follow: false },
      { user: { id: 74338319, user_profile: {}, user_path: "t:kuroppi1022", icon_url: "", name: "えるぴ", can_follow: true, is_admin: false }, rank: 2, total_view_count: 0, point: 1200, is_follow: false },
    ],
  },
];
/** 2026-10-07 12:00 JST */
const NOW = new Date("2026-10-07T03:00:00.000Z");
const DAY7 = { start: new Date("2026-10-06T15:00:00.000Z"), end: new Date("2026-10-07T15:00:00.000Z") };

function mockFetch(handler: (url: URL) => unknown) {
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    const u = new URL(String(url));
    const body = handler(u);
    return new Response(JSON.stringify(body), { status: 200 });
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe("WGP と N-1 のランキング取得", () => {
  let originalFetch: typeof global.fetch;
  beforeEach(() => {
    originalFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("wgp-daily は今日（JST）の /wgp/ranking/YYYYMMDD を叩き、期間つきの種別で返す", async () => {
    const fetchMock = mockFetch((u) => {
      expect(u.pathname).toBe("/wgp/ranking/20261007");
      return WGP_DAILY;
    });
    const r = await getRankings("wgp-daily", { now: NOW });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.rankingType).toBe("wgp-daily-20261007");
    expect(r.status).toBe(1);
    expect(r.title).toBe("リアルタイム更新中");
    expect(r.entries).toHaveLength(3);
    expect(r.entries[0]).toMatchObject({ rank: 1, point: 1116, userId: "36838348", userPath: "w:koyuaking", name: "A", totalViewCount: 0 });
    expect(r.entries[2]).toMatchObject({ rank: 3, userPath: "t:kuroppi1022" });
  });

  it("翌日になっても、期間が 10/7 の 1 日なら 10/7 の順位表（期間に収める）", async () => {
    mockFetch((u) => {
      expect(u.pathname).toBe("/wgp/ranking/20261007");
      return { ...WGP_DAILY, status: 3, title: "最終結果", is_fixed: true };
    });
    const r = await getRankings("wgp-daily", { now: new Date("2026-10-07T20:00:00.000Z"), window: DAY7 }); // 10/8 05:00 JST
    expect(r.rankingType).toBe("wgp-daily-20261007");
    expect(r.status).toBe(3);
  });

  it("wgp-overall は /wgp/ranking/overall/YYYYMM。21 日より前は空の順位表（エラーではない）", async () => {
    mockFetch((u) => {
      expect(u.pathname).toBe("/wgp/ranking/overall/202610");
      return WGP_OVERALL_EMPTY;
    });
    const r = await getRankings("wgp-overall", { now: NOW });
    expect(r.rankingType).toBe("wgp-overall-202610");
    expect(r.entries).toEqual([]);
    expect(r.status).toBe(1);
  });

  it("期間つきの種別はそのまま叩く（過去日・過去月）", async () => {
    const seen: string[] = [];
    mockFetch((u) => {
      seen.push(u.pathname);
      return u.pathname.includes("overall") ? { ...WGP_OVERALL_EMPTY, month: 9, status: 3 } : WGP_DAILY;
    });
    expect((await getWgpRankings("wgp-daily-20261006")).rankingType).toBe("wgp-daily-20261006");
    expect((await getWgpRankings("wgp-overall-202609")).rankingType).toBe("wgp-overall-202609");
    expect(seen).toEqual(["/wgp/ranking/20261006", "/wgp/ranking/overall/202609"]);
  });

  it("HTTP 200 の error_code（Z-001）は 404 の例外。期間なしの種別を直接渡すのは 400", async () => {
    mockFetch(() => ({ error_code: "Z-001", error_message: "ご利用いただけません。運営までお問い合わせください(Z-001)" }));
    const err = await getRankings("wgp-daily", { now: NOW }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WhowatchRankingApiError);
    expect((err as WhowatchRankingApiError).status).toBe(404);
    expect((err as Error).message).toContain("Z-001");
    const bad = await getWgpRankings("wgp-daily").catch((e: unknown) => e);
    expect((bad as WhowatchRankingApiError).status).toBe(400);
  });

  it("n1-male は今の回の /rankings/nice_one_1st_male/YYYYMM?limit=&detail=true を叩き、期間つきの種別（n1-male-202610-1st）で返す", async () => {
    const fetchMock = mockFetch((u) => {
      expect(u.pathname).toBe("/rankings/nice_one_1st_male/202610");
      expect(u.searchParams.get("detail")).toBe("true");
      expect(u.searchParams.get("limit")).toBe("100");
      return N1_MALE;
    });
    const r = await getRankings("n1-male", { now: NOW });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 応答の ranking_type（NICE_ONE_1ST_MALE）ではなく、こちらの期間つきの種別で記録する
    expect(r.rankingType).toBe("n1-male-202610-1st");
    expect(r.status).toBe(1);
    expect(r.entries).toHaveLength(2);
    expect(r.entries[1]).toMatchObject({ rank: 2, point: 1200, userPath: "t:kuroppi1022", name: "えるぴ" });
  });

  it("回は今の日付で決まる（10/15 → 2nd）。全期間は /rankings/nice_one_total/YYYYMM", async () => {
    const seen: string[] = [];
    mockFetch((u) => {
      seen.push(u.pathname);
      return [{ ...N1_MALE[0], ranking_type: "X" }];
    });
    expect((await getRankings("n1-female", { now: new Date("2026-10-15T03:00:00.000Z") })).rankingType).toBe("n1-female-202610-2nd");
    expect((await getRankings("n1-total", { now: NOW })).rankingType).toBe("n1-total-202610");
    expect((await getN1Rankings("n1-rookie-202609-3rd")).rankingType).toBe("n1-rookie-202609-3rd");
    expect(seen).toEqual(["/rankings/nice_one_2nd_female/202610", "/rankings/nice_one_total/202610", "/rankings/nice_one_3rd_rookie/202609"]);
  });

  it("N-1 の空配列（無い種別）は 502、期間なしの種別を直接渡すのは 400", async () => {
    mockFetch(() => []);
    const err = await getRankings("n1-male", { now: NOW }).catch((e: unknown) => e);
    expect((err as WhowatchRankingApiError).status).toBe(502);
    const bad = await getN1Rankings("n1-male").catch((e: unknown) => e);
    expect((bad as WhowatchRankingApiError).status).toBe(400);
  });

  it("従来の種別と期間限定アイテム型はこれまでどおり", async () => {
    const seen: string[] = [];
    mockFetch((u) => {
      seen.push(u.pathname);
      return u.pathname.startsWith("/events/") ? { rankings: [] } : [{ ranking_type: "AUTUMNCOLLECTION_1ST_OVERALL", status: 1, rankings: [{ user: { id: 1, user_path: "w:a", name: "A" }, rank: 1, point: 10 }] }];
    });
    expect((await getRankings("autumncollection_1st_overall")).rankingType).toBe("AUTUMNCOLLECTION_1ST_OVERALL");
    expect((await getRankings("limited-item-2026_10_gold_digger_1-2", { now: NOW })).rankingType).toBe("limited-item-2026_10_gold_digger_1-2-20261007");
    expect(seen).toEqual(["/rankings/autumncollection_1st_overall", "/events/limited_item_rankings"]);
  });
});
