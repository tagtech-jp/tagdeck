import { describe, expect, it } from "vitest";
import { findMyEntry, normalizeRankingResponse, selectAutoRivals, type RankingEntryApi } from "./rankings";

// 2026-09-20 実応答（autumncollection_1st_overall）の縮約
const API_RESPONSE = [
  {
    title: "リアルタイム更新中",
    short_name: "前半 総合ランキング",
    status: 1,
    ranking_type: "AUTUMNCOLLECTION_1ST_OVERALL",
    rankings: [
      { user: { id: 54643268, user_path: "w:myun828", name: "モ モ" }, rank: 1, total_view_count: 12905, point: 1934555 },
      { user: { id: 2, user_path: "w:b", name: "B" }, rank: 2, point: 900000 },
      { user: { id: 3, user_path: "w:c", name: "C" }, rank: 3, point: 800000 },
      { user: { id: 4, user_path: "w:d", name: "D" }, rank: 4, point: 700000 },
      { user: { id: 5, user_path: "w:e", name: "E" }, rank: 5, point: 600000 },
      { user: { id: 74338319, user_path: "t:kuroppi1022", name: "えるぴ" }, rank: 6, point: 500000 },
      { user: { id: 7, user_path: "w:g", name: "G" }, rank: 7, point: 400000 },
    ],
  },
];

function entries(): RankingEntryApi[] {
  return normalizeRankingResponse(API_RESPONSE, "autumncollection_1st_overall")!.entries;
}

describe("normalizeRankingResponse", () => {
  it("配列応答から ranking_type 一致ブロックを正規化する（大文字小文字は無視）", () => {
    const r = normalizeRankingResponse(API_RESPONSE, "autumncollection_1st_overall")!;
    expect(r.status).toBe(1);
    expect(r.title).toBe("リアルタイム更新中");
    expect(r.entries).toHaveLength(7);
    expect(r.entries[0]).toMatchObject({ rank: 1, point: 1934555, userId: "54643268", userPath: "w:myun828", name: "モ モ", totalViewCount: 12905 });
    expect(r.entries[1].totalViewCount).toBeNull();
  });

  it("空応答は null", () => {
    expect(normalizeRankingResponse([], "x")).toBeNull();
    expect(normalizeRankingResponse(null, "x")).toBeNull();
  });
});

describe("findMyEntry", () => {
  it("whowatchUserId（@名 / t: 付き / 数値 id）で自分を特定する", () => {
    const es = entries();
    expect(findMyEntry(es, { whowatchUserId: "@kuroppi1022" })?.rank).toBe(6);
    expect(findMyEntry(es, { whowatchUserId: "t:kuroppi1022" })?.rank).toBe(6);
    expect(findMyEntry(es, { whowatchUserId: "74338319" })?.rank).toBe(6);
  });
  it("id で見つからなければ myEntryName（表示名）で探す", () => {
    expect(findMyEntry(entries(), { whowatchUserId: "nobody", myEntryName: "えるぴ" })?.rank).toBe(6);
    expect(findMyEntry(entries(), { myEntryName: "存在しない" })).toBeNull();
  });
});

describe("selectAutoRivals", () => {
  it("目標順位の前後 3 名 + 自分の直上を、自分を除いて順位順に返す", () => {
    const es = entries();
    const me = es.find((e) => e.rank === 6)!;
    const rivals = selectAutoRivals(es, 3, me);
    expect(rivals.map((r) => r.rank)).toEqual([2, 3, 4, 5]);
  });
  it("目標 1 位なら 1・2 位、自分が 1 位なら直上は無い", () => {
    const es = entries();
    expect(selectAutoRivals(es, 1, null).map((r) => r.rank)).toEqual([1, 2]);
    const top = es.find((e) => e.rank === 1)!;
    expect(selectAutoRivals(es, 1, top).map((r) => r.rank)).toEqual([2]);
  });
  it("自分が目標圏内なら自分は除外される", () => {
    const es = entries();
    const me = es.find((e) => e.rank === 6)!;
    expect(selectAutoRivals(es, 6, me).map((r) => r.rank)).toEqual([5, 7]);
  });
});
