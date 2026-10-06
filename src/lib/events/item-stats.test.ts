import { describe, expect, it } from "vitest";
import {
  compileDistribution,
  distributionFromMultiplierTable,
  distributionFromValueTable,
  drawsUntil,
  itemValueMean,
  itemValueQuantile,
  itemValueSd,
  itemsNeededStats,
  OPEN_ENDED_MAX_RATIO,
  sampleItemValue,
  seededRandom,
  summarizeItemValue,
  tierBounds,
  type ItemValueDistribution,
} from "./item-stats";

// 黄金発掘隊（2026_10_gold_digger_1）の概要本文の表（2026-10-07）
const GOLD: ItemValueDistribution = {
  kind: "range",
  unit: "kg",
  tiers: [
    { probability: 0.1, min: 500, max: null, label: "超巨大な金塊" },
    { probability: 3.9, min: 300, max: 499, label: "巨大な金塊" },
    { probability: 16, min: 100, max: 299, label: "大きい金塊" },
    { probability: 30, min: 50, max: 99, label: "中くらいの金塊" },
    { probability: 50, min: 10, max: 49, label: "小さい金塊" },
  ],
};
// マジックファンタジー相当: 基礎 100pt、1%=20 倍 / 4%=10 倍 / 10%=5 倍 / 85%=通常（期待倍率 1.95）
const MULT = distributionFromMultiplierTable(
  [
    { probability: 1, multiplier: 20 },
    { probability: 4, multiplier: 10 },
    { probability: 10, multiplier: 5 },
    { probability: 85, multiplier: 1 },
  ],
  100,
)!;

describe("1 個あたりの分布（重量表・倍率表）", () => {
  it("黄金発掘隊: 平均 約 85 kg・標準偏差 約 94 kg（ばらつきが平均より大きい）", () => {
    expect(itemValueMean(GOLD)).toBeCloseTo(85.3, 0);
    expect(itemValueSd(GOLD)).toBeGreaterThan(90);
    expect(itemValueSd(GOLD)).toBeLessThan(97);
    const s = summarizeItemValue(GOLD);
    expect(s.unit).toBe("kg");
    // 半分は 10〜49 kg なので中央値は 49 kg 以下、上位 10% は 100 kg 台
    expect(s.median).toBeLessThanOrEqual(49);
    expect(s.p90).toBeGreaterThan(200);
    expect(s.p90).toBeLessThan(260);
  });

  it("開いた段（500 kg〜）は下限の 2 倍まで（500〜999）と仮定する", () => {
    expect(OPEN_ENDED_MAX_RATIO).toBe(2);
    expect(tierBounds({ probability: 0.1, min: 500, max: null })).toEqual({ min: 500, max: 999 });
    expect(tierBounds({ probability: 50, min: 10, max: 49 })).toEqual({ min: 10, max: 49 });
  });

  it("倍率表型: 平均 = 基礎 pt × 期待倍率（100 × 1.95）", () => {
    expect(itemValueMean(MULT)).toBeCloseTo(195, 5);
    expect(itemValueQuantile(MULT, 0.5)).toBe(100);
    expect(itemValueQuantile(MULT, 0.99)).toBeGreaterThanOrEqual(1000);
    expect(summarizeItemValue(MULT).unit).toBe("pt");
  });

  it("空の表は平均 0・compile は null、基礎 pt が無ければ倍率表の分布は作らない", () => {
    const empty: ItemValueDistribution = { kind: "range", unit: "kg", tiers: [] };
    expect(itemValueMean(empty)).toBe(0);
    expect(compileDistribution(empty)).toBeNull();
    expect(distributionFromMultiplierTable([{ probability: 100, multiplier: 1 }], null)).toBeNull();
    expect(distributionFromValueTable(null, "kg")).toBeNull();
    expect(distributionFromValueTable([{ probability: 100, min: 10, max: 49 }], "kg")).toMatchObject({ kind: "range", unit: "kg" });
  });

  it("引き方: 乱数 0 なら最も軽い段の下限、乱数 1 に近ければ最も重い段の上限付近", () => {
    expect(sampleItemValue(GOLD, () => 0)).toBe(10);
    expect(sampleItemValue(GOLD, () => 0.9999)).toBeGreaterThanOrEqual(500);
    expect(sampleItemValue(MULT, () => 0)).toBe(100);
  });
});

describe("必要個数の統計（モンテカルロ）", () => {
  it("1,000 kg 足りないとき: 平均なら 12 個弱、中央値はその前後、90% なら 2 割ほど多い", () => {
    const s = itemsNeededStats(1000, GOLD, { iterations: 4000, rng: seededRandom(42) })!;
    expect(s.mean).toBeCloseTo(1000 / itemValueMean(GOLD), 5);
    expect(s.p50).toBeGreaterThanOrEqual(9);
    expect(s.p50).toBeLessThanOrEqual(15);
    expect(s.p90).toBeGreaterThan(s.p50);
    expect(s.p90).toBeGreaterThanOrEqual(15);
    expect(s.p90).toBeLessThanOrEqual(25);
    expect(s.iterations).toBe(4000);
  });

  it("足りている（gap 0）なら 0 個、表が空なら null、同じ乱数なら同じ答え", () => {
    expect(itemsNeededStats(0, GOLD)).toMatchObject({ mean: 0, p50: 0, p90: 0 });
    expect(itemsNeededStats(100, { kind: "range", unit: "kg", tiers: [] })).toBeNull();
    const a = itemsNeededStats(500, GOLD, { iterations: 500, rng: seededRandom(7) });
    const b = itemsNeededStats(500, GOLD, { iterations: 500, rng: seededRandom(7) });
    expect(a).toEqual(b);
  });

  it("drawsUntil: 前計算した分布でも同じ。上限で打ち切る", () => {
    const c = compileDistribution(GOLD)!;
    expect(drawsUntil(0, c, seededRandom(1))).toBe(0);
    expect(drawsUntil(1_000_000, c, seededRandom(1), 50)).toBe(50);
    const n = drawsUntil(300, c, seededRandom(3));
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThan(50);
  });
});
