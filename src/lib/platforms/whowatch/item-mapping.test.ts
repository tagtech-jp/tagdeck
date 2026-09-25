// @ts-nocheck — vitest は devDependency として別途 `pnpm add -D vitest` が必要
import { describe, it, expect } from "vitest";
import { WHOWATCH_ITEMS, WHOWATCH_MULTIPLIERS } from "./item-mapping";

describe("WHOWATCH_ITEMS", () => {
  it("has exactly 7 items (HAR 確認済みアイテム数)", () => {
    expect(WHOWATCH_ITEMS).toHaveLength(7);
  });

  it("all items have basePoint > 0", () => {
    for (const item of WHOWATCH_ITEMS) {
      expect(item.basePoint).toBeGreaterThan(0);
    }
  });

  it("all ids are unique", () => {
    const ids = WHOWATCH_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all names are non-empty strings", () => {
    for (const item of WHOWATCH_ITEMS) {
      expect(typeof item.name).toBe("string");
      expect(item.name.length).toBeGreaterThan(0);
    }
  });

  it("all 7 items have basePoint exactly 160 (event common items)", () => {
    for (const item of WHOWATCH_ITEMS) {
      expect(item.basePoint).toBe(160);
    }
  });

  it("includes ouen_wanchan (ワンちゃんさん) which has 33x multiplier", () => {
    const wan = WHOWATCH_ITEMS.find((i) => i.id === "ouen_wanchan");
    expect(wan).toBeDefined();
    expect(wan?.name).toContain("ワンちゃん");
  });
});

describe("WHOWATCH_MULTIPLIERS", () => {
  it("equals [1, 2, 20, 33] (HAR 確認済み・旧 {3,5,10} は誤情報)", () => {
    expect([...WHOWATCH_MULTIPLIERS]).toEqual([1, 2, 20, 33]);
  });

  it("has 4 entries", () => {
    expect(WHOWATCH_MULTIPLIERS).toHaveLength(4);
  });

  it("includes 33 (ワンちゃんさん専用最大倍率)", () => {
    expect(WHOWATCH_MULTIPLIERS).toContain(33);
  });

  it("does NOT include 3, 5, 10 (旧誤情報)", () => {
    expect(WHOWATCH_MULTIPLIERS).not.toContain(3);
    expect(WHOWATCH_MULTIPLIERS).not.toContain(5);
    expect(WHOWATCH_MULTIPLIERS).not.toContain(10);
  });
});
