import { describe, expect, it } from "vitest";
import { mergeBurstGifts, normalizeGift, shouldPlayGiftSe, type PatternInfo } from "./gift-normalize";

// イベントの無料配布アイテム（どんぐり）と、有料アイテム（花火）
const acorn: PatternInfo = { patternId: 1, itemId: 10, itemName: "どんぐり", patternName: "どんぐり", isHit: false, hitGrade: null, quantity: null, priceJpy: null, animationUrl: null, animationFullscreen: false, groups: ["autumncollection"], freeEvent: true };
const acornBundle: PatternInfo = { ...acorn, patternId: 2, patternName: "どんぐり × 3", quantity: 3 };
const fireworks: PatternInfo = { patternId: 3, itemId: 20, itemName: "花火", patternName: "花火", isHit: false, hitGrade: null, quantity: null, priceJpy: 1000, animationUrl: null, animationFullscreen: false, groups: [] };
const lookup = (id: number) => [acorn, acornBundle, fireworks].find((p) => p.patternId === id) ?? null;
const gift = (patternId: number, itemCount: number) => normalizeGift({ id: `${patternId}-${itemCount}`, play_item_pattern_id: patternId, item_count: itemCount }, lookup);

describe("shouldPlayGiftSe（イベントの無料アイテムは 3 個まとめ投げだけ鳴らす）", () => {
  it("無料イベントアイテムの 1 個・2 個は鳴らさない", () => {
    expect(gift(1, 1).free_event).toBe(true);
    expect(shouldPlayGiftSe(gift(1, 1))).toBe(false);
    expect(shouldPlayGiftSe(gift(1, 2))).toBe(false);
  });
  it("無料イベントアイテムの 3 個以上のまとめ投げは鳴らす", () => {
    expect(shouldPlayGiftSe(gift(1, 3))).toBe(true);
    expect(shouldPlayGiftSe(gift(1, 10))).toBe(true);
  });
  it("束パターン（× 3）は 1 回投げでも 3 個として鳴らす", () => {
    expect(shouldPlayGiftSe(gift(2, 1))).toBe(true);
  });
  it("有料アイテム・未知パターンは個数に関係なく鳴らす", () => {
    expect(gift(3, 1).free_event).toBe(false);
    expect(shouldPlayGiftSe(gift(3, 1))).toBe(true);
    expect(shouldPlayGiftSe(gift(999, 1))).toBe(true);
  });
});

describe("mergeBurstGifts（同じ人の連投をまとめる）", () => {
  const user = (id: string | null, anonymized = false) => ({ id, name: id, user_path: null, anonymized });
  const g = (patternId: number, itemCount: number, u = user("u1")) => ({ ...gift(patternId, itemCount), user: u });

  it("同じ人・同じアイテムは個数と金額を合計する", () => {
    const m = mergeBurstGifts(g(3, 1), g(3, 2));
    expect(m).toMatchObject({ item_id: 20, count: 3, item_count: 3, total_yen: 3000 });
  });
  it("別の人・別のアイテム・匿名はまとめない", () => {
    expect(mergeBurstGifts(g(3, 1), g(3, 1, user("u2")))).toBeNull();
    expect(mergeBurstGifts(g(3, 1), g(1, 3))).toBeNull();
    expect(mergeBurstGifts(g(3, 1, user(null, true)), g(3, 1, user(null, true)))).toBeNull();
  });
  it("アイテム不明（未知パターン）はまとめない", () => {
    expect(mergeBurstGifts(g(999, 1), g(999, 1))).toBeNull();
  });
  it("当たりが混ざれば当たりのパターンを採り、段階は高い方", () => {
    const hit = { ...g(3, 1), is_hit: true, pattern_id: 30, bulk_grade: "COOL" as const };
    const m = mergeBurstGifts({ ...g(3, 5), bulk_grade: "GREAT" }, hit);
    expect(m).toMatchObject({ is_hit: true, pattern_id: 30, bulk_grade: "GREAT", count: 6 });
  });
});
