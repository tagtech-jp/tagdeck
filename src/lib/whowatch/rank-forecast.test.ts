import { describe, expect, it } from "vitest";
import { effectiveRemainingHours, estimateRivalPaces, forecastRank, itemsNeededFor, type SnapshotLike } from "./rank-forecast";

function snap(at: string, points: Record<string, number>): SnapshotLike {
  const entries = Object.entries(points)
    .sort((a, b) => b[1] - a[1])
    .map(([name, point], i) => ({ rank: i + 1, point, user_id: name, user_path: `w:${name}`, name }));
  return { capturedAt: at, entries };
}

const S1 = snap("2026-09-25T00:00:00Z", { A: 1000, B: 800, C: 600, D: 400, E: 200, me: 100 });
const S2 = snap("2026-09-25T01:00:00Z", { A: 1100, B: 900, C: 650, D: 420, E: 200, me: 150 });
const S3 = snap("2026-09-25T02:00:00Z", { A: 1200, B: 1000, C: 700, D: 440, E: 200, me: 200 });

describe("estimateRivalPaces", () => {
  it("2 枚以上のスナップショットから pt/時 を推定し、自分を除外する", () => {
    const r = estimateRivalPaces([S1, S2, S3], { excludeKey: "me" });
    const byName = Object.fromEntries(r.map((x) => [x.name, x]));
    expect(byName.A.paceMean).toBe(100);
    expect(byName.C.paceMean).toBe(50);
    expect(byName.E.paceMean).toBe(0);
    expect(byName.me).toBeUndefined();
    expect(byName.A.samples).toBe(2);
  });
  it("1 枚なら空", () => {
    expect(estimateRivalPaces([S1])).toEqual([]);
  });
});

describe("effectiveRemainingHours", () => {
  it("最終日に重なる時間だけ係数を掛ける", () => {
    const end = new Date("2026-09-28T00:00:00+09:00"); // 9/27 24:00 JST
    const now = new Date("2026-09-26T12:00:00+09:00"); // 残り 36h、うち最終日 24h
    const r = effectiveRemainingHours(now, end, 1.5);
    expect(r.remainingHours).toBe(36);
    expect(r.finalDayHours).toBe(24);
    expect(r.effectiveHours).toBe(12 + 24 * 1.5);
  });
});

describe("forecastRank", () => {
  const base = {
    snapshots: [S1, S2, S3],
    myKey: "me",
    myPoint: 200,
    now: new Date("2026-09-25T02:00:00Z"),
    endTime: new Date("2026-09-25T12:00:00Z"), // 残り 10h（最終日 24h 以内なので係数が効く）
    iterations: 4000,
    itemBasePoint: 160,
    expectedMultiplier: 1.95,
  };

  it("目標 5 位: E(停滞)を抜くだけなので確率が高く、必要 pt は小さい", () => {
    const r = forecastRank({ ...base, targetRank: 5, myPaceMean: 50, myPaceStdDev: 10 });
    expect(r.rankProbability).toBeGreaterThan(95);
    expect(r.requiredPoints.p50).toBeGreaterThanOrEqual(0);
    expect(r.requiredPoints.p50).toBeLessThan(200);
    expect(r.itemsNeeded).not.toBeNull();
    expect(r.usedFinalDayCoefficient).toBe(true);
    expect(r.snapshotCount).toBe(3);
  });

  it("目標 1 位: A(100pt/h)に届かず確率は低く、必要 pt は 1000 超", () => {
    const r = forecastRank({ ...base, targetRank: 1, myPaceMean: 50, myPaceStdDev: 10 });
    expect(r.rankProbability).toBeLessThan(5);
    expect(r.requiredPoints.p50).toBeGreaterThan(1000);
    expect(r.requiredPoints.p90).toBeGreaterThanOrEqual(r.requiredPoints.p50);
    // 1 日あたり = 個数 / ceil(10h/24h)=1
    expect(r.itemsPerDay!.p50).toBe(r.itemsNeeded!.p50);
  });

  it("スナップショット 1 枚なら予測不能として現状で判定する", () => {
    const r = forecastRank({ ...base, snapshots: [S3], targetRank: 3, myPaceMean: 0, myPaceStdDev: 1 });
    expect(r.note).toContain("2 枚未満");
    expect(r.rivals).toEqual([]);
  });
});

describe("itemsNeededFor", () => {
  it("ceil(必要pt / (基礎pt × 期待倍率))", () => {
    expect(itemsNeededFor(1000, 160, 1.95)).toBe(4); // 1000 / 312 = 3.2 → 4
    expect(itemsNeededFor(0, 160, 1.95)).toBe(0);
    expect(itemsNeededFor(100, 0, 1)).toBe(0);
  });
});
