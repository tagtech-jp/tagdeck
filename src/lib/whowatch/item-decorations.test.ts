import { describe, expect, it } from "vitest";
import { flattenDecorations, pickLiveId } from "./item-decorations";

describe("pickLiveId", () => {
  it("配列・{lives: [...]} のどちらからも先頭の id を選ぶ", () => {
    expect(pickLiveId([{ id: 76429953 }, { id: 1 }])).toBe(76429953);
    expect(pickLiveId({ lives: [{ id: 5 }] })).toBe(5);
    expect(pickLiveId({ error_code: "Z-001" })).toBeNull();
    expect(pickLiveId([])).toBeNull();
  });
});

describe("flattenDecorations", () => {
  it("playitems3 の user_retain_items をアイテム行にする（段階なしも行にする・重複は 1 行）", () => {
    const now = new Date("2026-09-28T00:00:00Z");
    const rows = flattenDecorations(
      [
        { play_item_id: 13098, patterns: [{ name: "バスケット", pattern_limit: 999, pattern_decorations: [{ count: 50, pattern_decoration: "GREAT" }, { count: 25, pattern_decoration: "COOL" }] }] },
        { play_item_id: 11182, patterns: [{ name: "投票券", pattern_limit: 999, pattern_decorations: [] }] },
        { play_item_id: 13098, patterns: [{ name: "バスケット" }] },
        { patterns: [{ name: "id なし" }] },
      ],
      now,
    );
    expect(rows).toEqual([
      { itemId: 13098, itemName: "バスケット", decorations: [{ count: 25, grade: "COOL" }, { count: 50, grade: "GREAT" }], patternLimit: 999, syncedAt: now },
      { itemId: 11182, itemName: "投票券", decorations: [], patternLimit: 999, syncedAt: now },
    ]);
  });
});
