import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLiveId, isGiftComment, liveIdFromProfile, normalizeGift, normalizeWhowatchUserPath, type PatternInfo } from "./live-feed";

const PATTERNS: Record<number, PatternInfo> = {
  116: { patternId: 116, itemId: 98, itemName: "ひよこ", patternName: "ひよこ", isHit: false, hitGrade: null, quantity: 1, priceJpy: 0, animationUrl: null, animationFullscreen: false, groups: [] },
  10365: { patternId: 10365, itemId: 98, itemName: "ひよこ", patternName: "ひよこのあたり", isHit: true, hitGrade: null, quantity: 1, priceJpy: 0, animationUrl: null, animationFullscreen: false, groups: ["autumncollection"] },
};
const lookup = (id: number) => PATTERNS[id] ?? null;

describe("liveIdFromProfile", () => {
  it("配信中は live[0].id、非配信は null", () => {
    expect(liveIdFromProfile({ live: [{ id: 76226641, title: "ギンギラ", started_at: 1789908731000 }] })).toEqual({ liveId: "76226641", title: "ギンギラ", startedAt: 1789908731000 });
    expect(liveIdFromProfile({ account_name: "@x" }).liveId).toBeNull();
  });
  it("live は配列ではなくオブジェクトでも取れる（実測形）", () => {
    expect(liveIdFromProfile({ live: { id: 76257563, title: "難しい", started_at: 1790008662000 } }).liveId).toBe("76257563");
  });
});

describe("normalizeWhowatchUserPath", () => {
  it("prefix なしの英数字は w: → t: の順に両方試す候補を返す", () => {
    expect(normalizeWhowatchUserPath("kuroppi1022")).toEqual({ path: "w:kuroppi1022", candidates: ["w:kuroppi1022", "t:kuroppi1022"] });
  });
  it("先頭の @ を除去する", () => {
    expect(normalizeWhowatchUserPath("@kuroppi1022").candidates).toEqual(["w:kuroppi1022", "t:kuroppi1022"]);
  });
  it("w: 付きはそのまま単一候補", () => {
    expect(normalizeWhowatchUserPath("w:Thomas19981022")).toEqual({ path: "w:Thomas19981022", candidates: ["w:Thomas19981022"] });
  });
  it("t: 付きはそのまま単一候補", () => {
    expect(normalizeWhowatchUserPath("t:kuroppi1022")).toEqual({ path: "t:kuroppi1022", candidates: ["t:kuroppi1022"] });
  });
  it("画面表示の ふ: は API パスの w: に読み替える", () => {
    expect(normalizeWhowatchUserPath("ふ:Thomas19981022")).toEqual({ path: "w:Thomas19981022", candidates: ["w:Thomas19981022"] });
  });
  it("prefix の大文字は小文字にする（ID 部分は変換しない）", () => {
    expect(normalizeWhowatchUserPath("W:Thomas19981022").candidates).toEqual(["w:Thomas19981022"]);
  });
  it("ID の大文字小文字は変換しない", () => {
    expect(normalizeWhowatchUserPath("Thomas19981022").candidates).toEqual(["w:Thomas19981022", "t:Thomas19981022"]);
  });
  it("数値のみは user_id として単一候補", () => {
    expect(normalizeWhowatchUserPath("74338319")).toEqual({ path: "74338319", candidates: ["74338319"] });
  });
  it("プロフィールURL（/profile/ 付き）から prefix ごと ID を取り出す", () => {
    // 回帰: 旧実装は whowatch.tv/profile/xxx から "profile" を抽出していた
    expect(normalizeWhowatchUserPath("https://whowatch.tv/profile/w:Thomas19981022").candidates).toEqual(["w:Thomas19981022"]);
  });
  it("プロフィールURL（/profile/ なし・@ 付き）からも取り出す", () => {
    expect(normalizeWhowatchUserPath("https://whowatch.tv/@erupi2525").candidates).toEqual(["w:erupi2525", "t:erupi2525"]);
  });
  it("URL の末尾スラッシュ・クエリ・パーセントエンコードを無視する", () => {
    expect(normalizeWhowatchUserPath("https://whowatch.tv/profile/t:kuroppi1022/?from=share").candidates).toEqual(["t:kuroppi1022"]);
    expect(normalizeWhowatchUserPath("https://whowatch.tv/profile/w%3AThomas19981022").candidates).toEqual(["w:Thomas19981022"]);
  });
  it("全角の英数字・コロンは半角に直す", () => {
    expect(normalizeWhowatchUserPath("ｗ：Ｔｈｏｍａｓ１９９８１０２２").candidates).toEqual(["w:Thomas19981022"]);
    expect(normalizeWhowatchUserPath("７４３３８３１９").candidates).toEqual(["74338319"]);
  });
  it("前後の空白・全角スペースを除去する", () => {
    expect(normalizeWhowatchUserPath("　 t:kuroppi1022 　").candidates).toEqual(["t:kuroppi1022"]);
  });
  it("空入力・prefix のみは候補なし", () => {
    expect(normalizeWhowatchUserPath("")).toEqual({ path: "", candidates: [] });
    expect(normalizeWhowatchUserPath("   ")).toEqual({ path: "", candidates: [] });
    expect(normalizeWhowatchUserPath("w:")).toEqual({ path: "", candidates: [] });
  });
});

describe("fetchLiveId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** path → 応答 JSON。未登録は U-002（実 API は存在しないユーザーも HTTP 200 で返す） */
  function stubApi(byPath: Record<string, unknown>): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async (url: string) => {
      const path = decodeURIComponent(new URL(url).pathname.split("/")[2] ?? "");
      const body = byPath[path] ?? { error_code: "U-002", error_message: "該当するユーザーが見つかりません(U-002)" };
      return { ok: true, json: async () => body } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("w: で見つからなければ t: にフォールバックする", async () => {
    const fetchMock = stubApi({ "t:kuroppi1022": { name: "えるぴ", user_path: "t:kuroppi1022", live: { id: 76257563, title: "雑談", started_at: 1790008662000 } } });
    await expect(fetchLiveId("kuroppi1022")).resolves.toEqual({ found: true, liveId: "76257563", title: "雑談", startedAt: 1790008662000, displayName: "えるぴ", userPath: "t:kuroppi1022" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("prefix 付きは 1 回しか問い合わせない", async () => {
    const fetchMock = stubApi({ "w:Thomas19981022": { name: "トーマス", user_path: "w:Thomas19981022", live: { id: 1, title: null, started_at: null } } });
    await expect(fetchLiveId("w:Thomas19981022")).resolves.toMatchObject({ found: true, liveId: "1", displayName: "トーマス" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ユーザーは居るが配信していない場合は found=true・liveId=null", async () => {
    stubApi({ "t:kuroppi1022": { name: "えるぴ", user_path: "t:kuroppi1022" } });
    await expect(fetchLiveId("kuroppi1022")).resolves.toEqual({ found: true, liveId: null, title: null, startedAt: null, displayName: "えるぴ", userPath: "t:kuroppi1022" });
  });

  it("全候補が U-002 なら found=false（非配信と区別する）", async () => {
    stubApi({});
    await expect(fetchLiveId("unknown_user")).resolves.toEqual({ found: false, liveId: null, title: null, startedAt: null, displayName: null, userPath: null });
  });
});

describe("normalizeGift", () => {
  it("BY_PLAYITEM を pattern/item/count/is_hit/comment_id に正規化する", () => {
    const c = { id: 6421014300, comment_type: "BY_PLAYITEM", play_item_pattern_id: 10365, item_count: 3, message: "ひよこをプレゼントしました。", anonymized: false, posted_at: 1789908903000, user: { id: 123, name: "太郎", user_path: "w:taro" } };
    expect(isGiftComment(c)).toBe(true);
    const g = normalizeGift(c, lookup);
    expect(g).toMatchObject({ comment_id: "6421014300", pattern_id: 10365, item_id: 98, item_name: "ひよこ", pattern_name: "ひよこのあたり", count: 3, is_hit: true, user: { id: "123", name: "太郎", user_path: "w:taro", anonymized: false } });
    expect(g.posted_at).toBe("2026-09-20T12:55:03.000Z");
  });
  it("匿名は user を伏せ、未知パターンは item 不明・count 既定 1", () => {
    const g = normalizeGift({ id: "x", comment_type: "BY_PLAYITEM", play_item_pattern_id: 99999, anonymized: true, user: { id: 5, name: "秘密" } }, lookup);
    expect(g.user).toEqual({ id: null, name: null, user_path: null, anonymized: true });
    expect(g.item_id).toBeNull();
    expect(g.count).toBe(1);
    expect(g.is_hit).toBe(false);
  });
  it("束パターン（風船 × 10・quantity 10）は個数 = item_count × quantity、合計 = 単価 × 個数", () => {
    const bundleLookup = (id: number) => (id === 2 ? { patternId: 2, itemId: 1, itemName: "風船", patternName: "風船 × 10", isHit: false, hitGrade: null, quantity: 10, priceJpy: 10, animationUrl: null, animationFullscreen: false, groups: [] } : null);
    const g = normalizeGift({ id: 1, comment_type: "BY_PLAYITEM", play_item_pattern_id: 2, item_count: 3, anonymized: false }, bundleLookup);
    expect(g.count).toBe(30);
    expect(g.price_yen).toBe(10);
    expect(g.total_yen).toBe(300);
  });
  it("単価不明なら total_yen は null", () => {
    const g = normalizeGift({ id: 2, comment_type: "BY_PLAYITEM", play_item_pattern_id: 99999, item_count: 2, anonymized: false }, lookup);
    expect(g.total_yen).toBeNull();
  });
  it("BY_PUBLIC はギフトではない", () => {
    expect(isGiftComment({ id: 1, comment_type: "BY_PUBLIC" })).toBe(false);
  });
});
