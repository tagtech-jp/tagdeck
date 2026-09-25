import { describe, expect, it } from "vitest";
import { itemKind, patternKind } from "./item-kind";

const p = (o: Partial<{ isHit: boolean; animationUrl: string | null; animationFullscreen: boolean }> = {}) => ({
  isHit: false,
  animationUrl: null,
  animationFullscreen: false,
  ...o,
});

describe("patternKind", () => {
  it("当たりが最優先", () => {
    expect(patternKind(p({ isHit: true }))).toBe("hit");
    expect(patternKind(p({ isHit: true, animationUrl: "https://x/a.json" }))).toBe("hit");
  });
  it("animation_url があれば演出付き", () => {
    expect(patternKind(p({ animationUrl: "https://x/a.json" }))).toBe("anim");
  });
  it("animation_url が無くても animation_fullscreen なら演出付き", () => {
    // 実測で全画面演出 334 件中 286 件が animation_url2 を持たない
    expect(patternKind(p({ animationFullscreen: true }))).toBe("anim");
  });
  it("どちらも無ければ通常", () => {
    expect(patternKind(p())).toBe("normal");
    expect(patternKind(p({ animationUrl: "" }))).toBe("normal");
  });
});

describe("itemKind", () => {
  it("パターンのいずれかが当たりなら当たり", () => {
    expect(itemKind([p(), p({ animationFullscreen: true }), p({ isHit: true })])).toBe("hit");
  });
  it("当たりが無く演出付きがあれば演出付き", () => {
    expect(itemKind([p(), p({ animationUrl: "https://x/a.json" })])).toBe("anim");
  });
  it("全て通常なら通常", () => {
    expect(itemKind([p(), p()])).toBe("normal");
  });
  it("パターンが無ければ通常", () => {
    expect(itemKind([])).toBe("normal");
  });
});
