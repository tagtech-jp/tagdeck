import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { entriesWithPublisher, findMyEntry, getRankings, normalizeLimitedItemRankingResponse, normalizeRankingResponse, type RankingEntryApi } from "./rankings";

// 2026-10-07 実測: /rankings/{type}?publisher_id=74338319 は、本人が上位 100 名の外（570 位）でも publisher_ranking に本人の行を返す。
// 本人がその部門の参加者でなければ publisher_ranking 自体が無い（女性・ルーキー部門）。名前は仮名
const N1_WITH_PUBLISHER = [
  {
    title: "リアルタイム更新中",
    status: 1,
    ranking_type: "NICE_ONE_1ST_MALE",
    rankings: [
      { user: { id: 37787543, user_path: "w:seiz1234", name: "C" }, rank: 1, total_view_count: 0, point: 24439 },
      { user: { id: 3835144, user_path: "w:y1919yy1919y", name: "D" }, rank: 2, total_view_count: 0, point: 20000 },
    ],
    publisher_ranking: { user: { id: 74338319, user_path: "t:kuroppi1022", name: "えるぴ" }, rank: 570, total_view_count: 0, point: 4, next_rank: 510, ranking_up_point: 2, is_follow: false },
  },
];
// /events/limited_item_rankings?…&publisher_id= の publisher_ranking は一覧の行と同じ平らな形
const LIMITED_WITH_PUBLISHER = {
  rankings: [{ user_id: 72252879, user_name: "A", user_path: "w:a", rank: 1, point: 6831.0 }],
  publisher_ranking: { user_id: 74338319, user_name: "えるぴ", user_path: "t:kuroppi1022", icon_url: "", rank: 16, next_rank: 15, point: 136.0, rank_up_point: 16.0, live_id: 76658050 },
};
const ME = { whowatchUserId: "kuroppi1022" };
const NOW = new Date("2026-10-07T03:00:00.000Z");

describe("publisher_ranking（本人の行）の正規化", () => {
  it("/rankings 系: 一覧に居ない本人の行を publisher に入れる。無ければ null", () => {
    const r = normalizeRankingResponse(N1_WITH_PUBLISHER, "nice_one_1st_male")!;
    expect(r.entries).toHaveLength(2);
    expect(r.publisher).toEqual({ rank: 570, point: 4, userId: "74338319", userPath: "t:kuroppi1022", name: "えるぴ", totalViewCount: 0 });
    expect(normalizeRankingResponse([{ ...N1_WITH_PUBLISHER[0], publisher_ranking: undefined }], "nice_one_1st_male")!.publisher).toBeNull();
  });

  it("期間限定アイテム型: 平らな行の形。point は整数に丸める", () => {
    const r = normalizeLimitedItemRankingResponse(LIMITED_WITH_PUBLISHER, "limited-item-2026_10_gold_digger_1-2-20261007")!;
    expect(r.entries).toHaveLength(1);
    expect(r.publisher).toEqual({ rank: 16, point: 136, userId: "74338319", userPath: "t:kuroppi1022", name: "えるぴ", totalViewCount: null });
    expect(normalizeLimitedItemRankingResponse({ rankings: [] }, "x")!.publisher).toBeNull();
  });

  it("findMyEntry は一覧に居なければ publisher の行で本人を見つける。一覧に居ればそちら", () => {
    const r = normalizeRankingResponse(N1_WITH_PUBLISHER, "nice_one_1st_male")!;
    expect(findMyEntry(r.entries, ME)).toBeNull();
    expect(findMyEntry(r.entries, ME, r.publisher)).toMatchObject({ rank: 570, point: 4 });
    expect(findMyEntry(r.entries, { whowatchUserId: "t:kuroppi1022" }, r.publisher)?.rank).toBe(570);
    expect(findMyEntry(r.entries, { myEntryName: "えるぴ" }, r.publisher)?.rank).toBe(570);
    // 他人の publisher 行では見つけない
    expect(findMyEntry(r.entries, { whowatchUserId: "someone" }, r.publisher)).toBeNull();
    const inList: RankingEntryApi = { rank: 2, point: 20000, userId: "74338319", userPath: "t:kuroppi1022", name: "えるぴ", totalViewCount: 0 };
    expect(findMyEntry([r.entries[0], inList], ME, r.publisher)?.rank).toBe(2);
  });

  it("entriesWithPublisher は本人の行が一覧に無いときだけ末尾に足す", () => {
    const r = normalizeRankingResponse(N1_WITH_PUBLISHER, "nice_one_1st_male")!;
    expect(entriesWithPublisher(r).map((e) => e.rank)).toEqual([1, 2, 570]);
    const inList: RankingEntryApi = { rank: 2, point: 20000, userId: "74338319", userPath: "t:kuroppi1022", name: "えるぴ", totalViewCount: 0 };
    expect(entriesWithPublisher({ ...r, entries: [r.entries[0], inList] }).map((e) => e.rank)).toEqual([1, 2]);
    expect(entriesWithPublisher({ ...r, publisher: null }).map((e) => e.rank)).toEqual([1, 2]);
  });
});

describe("getRankings の publisherId", () => {
  let originalFetch: typeof global.fetch;
  beforeEach(() => {
    originalFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("N-1・期間限定アイテム型・従来の種別は publisher_id を付け、WGP は付けない", async () => {
    const seen: string[] = [];
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = new URL(String(url));
      seen.push(`${u.pathname}?${u.searchParams.get("publisher_id") ?? "-"}`);
      if (u.pathname.startsWith("/wgp/")) return new Response(JSON.stringify({ status: 1, rankings: [] }), { status: 200 });
      if (u.pathname.startsWith("/events/")) return new Response(JSON.stringify(LIMITED_WITH_PUBLISHER), { status: 200 });
      return new Response(JSON.stringify(N1_WITH_PUBLISHER), { status: 200 });
    }) as unknown as typeof fetch;
    const n1 = await getRankings("n1-male", { now: NOW, publisherId: "74338319" });
    expect(n1.publisher?.rank).toBe(570);
    const li = await getRankings("limited-item-2026_10_gold_digger_1-2", { now: NOW, publisherId: "74338319" });
    expect(li.publisher?.rank).toBe(16);
    await getRankings("autumncollection_1st_overall", { publisherId: "74338319" });
    await getRankings("wgp-daily", { now: NOW, publisherId: "74338319" });
    expect(seen).toEqual([
      "/rankings/nice_one_1st_male/202610?74338319",
      "/events/limited_item_rankings?74338319",
      "/rankings/autumncollection_1st_overall?74338319",
      "/wgp/ranking/20261007?-",
    ]);
  });
});
