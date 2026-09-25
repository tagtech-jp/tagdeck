// @ts-nocheck — vitest は devDependency として別途 `pnpm add -D vitest` が必要
import { describe, it, expect } from "vitest";
import { applyEmpiricalBayes } from "./bayesian";

// k₀=3 は内部定数。テストは外から観測可能な挙動のみ検証する。

describe("applyEmpiricalBayes", () => {
  // (a) 収束テスト: 過去データが多いほど posterior は historicalMean に近づく
  it("converges toward historicalMean with sampleCount=30", () => {
    const result = applyEmpiricalBayes({
      currentMean: 510,
      currentStd: 50,
      historicalMean: 490,
      historicalStd: 40,
      sampleCount: 30,
    });
    // k₀=3, n=30: μ_post = (3*510 + 30*490) / 33 ≈ 491.8
    expect(result.posteriorMean).toBeGreaterThan(490);
    expect(result.posteriorMean).toBeLessThan(510);
    expect(result.posteriorMean).toBeCloseTo(491.8, 0);
  });

  it("converges toward historicalMean with sampleCount=10", () => {
    const result = applyEmpiricalBayes({
      currentMean: 600,
      currentStd: 80,
      historicalMean: 400,
      historicalStd: 60,
      sampleCount: 10,
    });
    // k₀=3, n=10: μ_post = (3*600 + 10*400) / 13 ≈ 446.2
    expect(result.posteriorMean).toBeCloseTo(446.2, 0);
    expect(result.posteriorStd).toBeLessThan(60);
  });

  it("shrinks posteriorStd compared to historicalStd", () => {
    const result = applyEmpiricalBayes({
      currentMean: 500,
      currentStd: 50,
      historicalMean: 500,
      historicalStd: 50,
      sampleCount: 5,
    });
    // k₀=3, n=5: σ_post = 50 * √(3/8) ≈ 30.6
    expect(result.posteriorStd).toBeLessThan(50);
    expect(result.posteriorStd).toBeCloseTo(30.6, 0);
  });

  // (b) コールドスタートテスト: sampleCount=0 → Phase 5a と同一出力
  it("returns currentMean/currentStd unchanged when sampleCount=0", () => {
    const result = applyEmpiricalBayes({
      currentMean: 500,
      currentStd: 50,
      historicalMean: 0,
      historicalStd: 0,
      sampleCount: 0,
    });
    expect(result.posteriorMean).toBe(500);
    expect(result.posteriorStd).toBe(50);
  });

  // (c) 異常系テスト: NaN / Infinity / 負値 → フォールバック
  it("falls back when currentMean is NaN", () => {
    const result = applyEmpiricalBayes({
      currentMean: NaN,
      currentStd: 50,
      historicalMean: 400,
      historicalStd: 40,
      sampleCount: 10,
    });
    expect(result.posteriorMean).toBeNaN();
    expect(result.posteriorStd).toBe(50);
  });

  it("falls back when historicalStd is Infinity", () => {
    const result = applyEmpiricalBayes({
      currentMean: 500,
      currentStd: 50,
      historicalMean: 400,
      historicalStd: Infinity,
      sampleCount: 10,
    });
    expect(result.posteriorMean).toBe(500);
    expect(result.posteriorStd).toBe(50);
  });

  it("falls back when any value is negative", () => {
    const result = applyEmpiricalBayes({
      currentMean: 500,
      currentStd: -10,
      historicalMean: 400,
      historicalStd: 40,
      sampleCount: 10,
    });
    expect(result.posteriorMean).toBe(500);
    expect(result.posteriorStd).toBe(-10);
  });

  // (d) 重み比テスト: sampleCount が大きいほど historicalMean 寄りになる
  it("sampleCount=10 is more historical-biased than sampleCount=1", () => {
    const input = {
      currentMean: 800,
      currentStd: 100,
      historicalMean: 200,
      historicalStd: 80,
    };
    const low = applyEmpiricalBayes({ ...input, sampleCount: 1 });
    const high = applyEmpiricalBayes({ ...input, sampleCount: 10 });
    // sampleCount=10 → posterior は historicalMean (200) に近い
    expect(high.posteriorMean).toBeLessThan(low.posteriorMean);
  });
});
