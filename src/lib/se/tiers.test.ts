import { describe, expect, it } from "vitest";
import { resolveMappingKey, tierForGift } from "./tiers";

describe("tierForGift", () => {
  it("価格帯 × 個数でティア、当たりは hit", () => {
    expect(tierForGift({ priceYen: 0, count: 1, isHit: false })).toBe("T0");
    expect(tierForGift({ priceYen: null, count: 5, isHit: false })).toBe("T0");
    expect(tierForGift({ priceYen: 160, count: 1, isHit: false })).toBe("T1");
    expect(tierForGift({ priceYen: 160, count: 4, isHit: false })).toBe("T2"); // 640
    expect(tierForGift({ priceYen: 1000, count: 2, isHit: false })).toBe("T3"); // 2000
    expect(tierForGift({ priceYen: 2000, count: 3, isHit: false })).toBe("T4"); // 6000
    expect(tierForGift({ priceYen: 0, count: 1, isHit: true })).toBe("hit");
  });
});

describe("resolveMappingKey", () => {
  it("pattern → item → tier の優先順", () => {
    const keys = new Set(["item:98", "tier:T1", "pattern:10365"]);
    expect(resolveMappingKey(keys, { patternId: 10365, itemId: 98, tier: "hit" })).toBe("pattern:10365");
    expect(resolveMappingKey(keys, { patternId: 116, itemId: 98, tier: "T1" })).toBe("item:98");
    expect(resolveMappingKey(keys, { patternId: 1, itemId: 2, tier: "T1" })).toBe("tier:T1");
    expect(resolveMappingKey(keys, { patternId: 1, itemId: 2, tier: "T4" })).toBeNull();
  });

  it("個別（pattern / item）がカテゴリ一括より優先される", () => {
    const keys = new Set(["pattern:10365", "item:98", "cat:group:autumncollection", "cat:kind:hit", "tier:T1"]);
    expect(resolveMappingKey(keys, { patternId: 10365, itemId: 98, tier: "T1", kind: "hit", groups: ["autumncollection"] })).toBe("pattern:10365");
    expect(resolveMappingKey(keys, { patternId: 1, itemId: 98, tier: "T1", kind: "hit", groups: ["autumncollection"] })).toBe("item:98");
  });

  it("個別が無ければ cat:group → cat:kind → tier の順", () => {
    const keys = new Set(["cat:group:autumncollection", "cat:kind:hit", "tier:T1"]);
    expect(resolveMappingKey(keys, { patternId: 1, itemId: 2, tier: "T1", kind: "hit", groups: ["autumncollection"] })).toBe("cat:group:autumncollection");
    expect(resolveMappingKey(keys, { patternId: 1, itemId: 2, tier: "T1", kind: "hit", groups: [] })).toBe("cat:kind:hit");
    expect(resolveMappingKey(keys, { patternId: 1, itemId: 2, tier: "T1", kind: "anim", groups: [] })).toBe("tier:T1");
  });

  it("複数カテゴリに属する場合は渡された順（アイテムページの並び順）で最初に一致したものを使う", () => {
    const keys = new Set(["cat:group:wwboss", "cat:group:autumncollection", "tier:T1"]);
    // display_order は event_ouen_sale(1) → autumncollection(5) → wwboss(8) の順
    expect(resolveMappingKey(keys, { patternId: 1, itemId: 2, tier: "T1", groups: ["event_ouen_sale", "autumncollection", "wwboss"] })).toBe("cat:group:autumncollection");
    // 割り当てが wwboss にしか無ければそちらが使われる
    expect(resolveMappingKey(new Set(["cat:group:wwboss", "tier:T1"]), { patternId: 1, itemId: 2, tier: "T1", groups: ["event_ouen_sale", "autumncollection", "wwboss"] })).toBe("cat:group:wwboss");
  });

  it("kind / groups を渡さない既存の呼び出しは従来どおり動く", () => {
    const keys = new Set(["cat:kind:hit", "tier:T1"]);
    expect(resolveMappingKey(keys, { patternId: null, itemId: null, tier: "T1" })).toBe("tier:T1");
  });
});

describe("resolveMappingKey（まとめ投げの段階・2026-09-28）", () => {
  it("bulk:item:{id}:{段階} → pattern → bulk:{段階} → item の順", () => {
    const keys = new Set(["bulk:item:13098:FANTASTIC", "pattern:10644", "bulk:FANTASTIC", "item:13098", "tier:T0"]);
    expect(resolveMappingKey(keys, { patternId: 10643, itemId: 13098, tier: "T0", bulkGrade: "FANTASTIC" })).toBe("bulk:item:13098:FANTASTIC");
    // 10 倍の当たり（別 pattern_id）はアイテム別の段階が無ければパターン個別が勝つ
    expect(resolveMappingKey(keys, { patternId: 10644, itemId: 13098, tier: "hit", bulkGrade: "COOL" })).toBe("pattern:10644");
    // 全アイテム共通の段階はアイテム個別より優先
    expect(resolveMappingKey(keys, { patternId: 10643, itemId: 13098, tier: "T0", bulkGrade: "COOL" })).toBe("item:13098");
    expect(resolveMappingKey(new Set(["bulk:COOL", "item:13098"]), { patternId: 10643, itemId: 13098, tier: "T0", bulkGrade: "COOL" })).toBe("bulk:COOL");
    // 段階なし（しきい値未満）は従来どおり
    expect(resolveMappingKey(keys, { patternId: 10643, itemId: 13098, tier: "T0", bulkGrade: null })).toBe("item:13098");
  });
});
