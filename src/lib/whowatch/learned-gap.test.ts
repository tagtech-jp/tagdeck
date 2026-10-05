import { describe, expect, it } from "vitest";
import type { ExportItem } from "./item-export";
import { summarizeLearnedGaps } from "./learned-gap";

const item = (id: string, price: number, learned: number | null, samples = 5, event_key: string | null = null): ExportItem => ({
  item_id: id, item_name: `item${id}`, price_jpy: price, purchasable: price > 0, event_id: null, event_key, group_keys: [], state: price > 0 ? "OPEN" : "FREE", on_sale: price > 0, last_fetched_at: null,
  learned_point: learned, learned_samples: learned === null ? 0 : samples, learned_at: null,
});

describe("summarizeLearnedGaps", () => {
  it("ポイント÷円の中央値から 2 割以上ずれたものを、ずれの大きい順に出す", () => {
    const s = summarizeLearnedGaps([
      item("1", 100, 50), item("2", 200, 100), item("3", 1000, 500), // 比率 0.5（普通）
      item("4", 100, 150, 5, "ev"), // 3 倍（イベント倍率？）
      item("5", 100, 40), // -20%
      item("6", 100, 45), // -10%（出さない）
    ]);
    expect(s.median_point_per_jpy).toBe(0.5);
    expect(s.compared).toBe(6);
    expect(s.gaps.map((g) => [g.item_id, g.reason, g.deviation_pct])).toEqual([["4", "higher", 200], ["5", "lower", -20]]);
    expect(s.gaps[0]).toMatchObject({ expected_point: 50, event_key: "ev" });
  });

  it("無料なのにポイントが付くものは先頭に出す", () => {
    const s = summarizeLearnedGaps([item("1", 100, 50), item("2", 100, 50), item("3", 100, 50), item("9", 0, 10)]);
    expect(s.gaps[0]).toMatchObject({ item_id: "9", reason: "free_with_points", deviation_pct: null });
  });

  it("観測が少ない・未学習は使わない。比較できる件数が足りなければ中央値は null", () => {
    const s = summarizeLearnedGaps([item("1", 100, 50), item("2", 100, 500, 2), item("3", 100, null)]);
    expect(s.compared).toBe(1);
    expect(s.median_point_per_jpy).toBeNull();
    expect(s.gaps).toEqual([]);
  });
});
