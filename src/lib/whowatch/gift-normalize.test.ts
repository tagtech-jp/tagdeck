import { describe, expect, it } from "vitest";
import { normalizeGift, shouldPlayGiftSe, type PatternInfo } from "./gift-normalize";

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
