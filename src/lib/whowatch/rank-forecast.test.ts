import { describe, expect, it } from "vitest";
import {
  effectiveRemainingHours,
  estimateRivalPaces,
  forecastRank,
  itemsNeededFor,
  rateMultiplier,
  rateSigmaFor,
  type SnapshotLike,
} from "./rank-forecast";

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
    expect(byName.A.rank).toBe(1);
    expect(byName.A.eventAvgPace).toBeNull();
  });
  it("1 枚かつ開始時刻不明なら空", () => {
    expect(estimateRivalPaces([S1])).toEqual([]);
  });
  it("1 枚でも開始時刻があれば「現在 pt ÷ 経過時間」で推定する", () => {
    // 開始 2h 前 → A は 1200/2 = 600 pt/時
    const r = estimateRivalPaces([S3], { eventStart: new Date("2026-09-25T00:00:00Z") });
    const byName = Object.fromEntries(r.map((x) => [x.name, x]));
    expect(byName.A.paceMean).toBe(600);
    expect(byName.A.recentPace).toBeNull();
    expect(byName.A.eventAvgPace).toBe(600);
    expect(byName.A.samples).toBe(0);
    expect(byName.me.paceMean).toBe(100);
  });
  it("直近と全期間平均をサンプル数で重み付けして混ぜる", () => {
    // 直近 100 pt/時（2 サンプル）・全期間 1200/50h = 24 pt/時 → w = 2/14
    const r = estimateRivalPaces([S1, S2, S3], { eventStart: new Date("2026-09-23T00:00:00Z") });
    const a = r.find((x) => x.name === "A")!;
    const w = 2 / 14;
    expect(a.paceMean).toBeCloseTo(w * 100 + (1 - w) * 24, 6);
    expect(a.rateSigma).toBeCloseTo(rateSigmaFor(2), 6);
  });
});

describe("rateSigmaFor / rateMultiplier", () => {
  it("サンプルが多いほど σ が小さく、範囲は 0.3〜0.7", () => {
    expect(rateSigmaFor(0)).toBeCloseTo(0.7, 6);
    expect(rateSigmaFor(12)).toBeLessThan(rateSigmaFor(0));
    expect(rateSigmaFor(288)).toBeLessThan(rateSigmaFor(12));
    expect(rateSigmaFor(100000)).toBeGreaterThanOrEqual(0.3);
  });
  it("倍率の平均はほぼ 1（対数正規の平均補正）", () => {
    let sum = 0;
    const n = 50_000;
    for (let i = 0; i < n; i++) sum += rateMultiplier(0.6);
    expect(sum / n).toBeGreaterThan(0.95);
    expect(sum / n).toBeLessThan(1.05);
    expect(rateMultiplier(0)).toBe(1);
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
    // 自分はランキング内なので自分のペースもスナップショットから（50 pt/時）
    expect(r.myPace?.paceMean).toBe(50);
    expect(r.currentRank).toBe(6);
    expect(r.currentPoint).toBe(200);
  });

  it("目標 1 位: A(100pt/h)に届かず確率は低く、必要 pt は 1000 超", () => {
    const r = forecastRank({ ...base, targetRank: 1, myPaceMean: 50, myPaceStdDev: 10 });
    expect(r.rankProbability).toBeLessThan(5);
    expect(r.requiredPoints.p50).toBeGreaterThan(1000);
    expect(r.requiredPoints.p90).toBeGreaterThanOrEqual(r.requiredPoints.p50);
    // 1 日あたり = 個数 / ceil(10h/24h)=1
    expect(r.itemsPerDay!.p50).toBe(r.itemsNeeded!.p50);
  });

  it("期待順位と順位分布は全ライバルとの比較で決まる（試行数が一致する）", () => {
    const r = forecastRank({ ...base, targetRank: 3, myPaceMean: 50, myPaceStdDev: 10 });
    const total = Object.values(r.rankDistribution).reduce((a, b) => a + b, 0);
    expect(total).toBe(4000);
    expect(r.expectedRank).toBeGreaterThanOrEqual(r.bestRank);
    expect(r.expectedRank).toBeLessThanOrEqual(r.worstRank);
    // 停滞している E には確実に勝つので最悪でも 5 位
    expect(r.worstRank).toBeLessThanOrEqual(5);
    expect(r.myFinalPoints.p50).toBeGreaterThan(200);
    expect(r.myFinalPoints.p90).toBeGreaterThanOrEqual(r.myFinalPoints.p50);
  });

  it("スナップショット 1 枚・開始時刻不明なら予測不能として現状で判定する", () => {
    const r = forecastRank({ ...base, snapshots: [S3], targetRank: 3, myPaceMean: 0, myPaceStdDev: 1 });
    expect(r.note).toContain("2 枚未満");
    expect(r.rivals).toEqual([]);
    expect(r.rankProbability).toBe(0);
  });

  it("スナップショット 1 枚でも開始時刻があれば全期間平均で予測できる", () => {
    const r = forecastRank({
      ...base,
      snapshots: [S3],
      eventStart: new Date("2026-09-25T00:00:00Z"),
      targetRank: 5,
      myPaceMean: 0,
      myPaceStdDev: 1,
    });
    expect(r.rivals).toHaveLength(5);
    expect(r.myPace?.paceMean).toBe(100);
    // 1 枚では E の停滞は分からず、E も自分も 200pt/2h = 100 pt/時 と見なす → 5 位争いはほぼ五分（同点は先着優先で E）
    expect(r.rankProbability).toBeGreaterThan(30);
    expect(r.rankProbability).toBeLessThan(70);
    expect(r.note).not.toContain("2 枚未満");
  });

  it("自分がランキング外なら呼び出し側の pt とペースを使い、現在順位は null", () => {
    const r = forecastRank({ ...base, myKey: "ghost", myPoint: 50, targetRank: 5, myPaceMean: 0, myPaceStdDev: 1 });
    expect(r.currentRank).toBeNull();
    expect(r.currentPoint).toBe(50);
    expect(r.myPace).toBeNull();
    // 6 名全員がライバル。E(200・停滞)に 50 のまま届かないので目標 5 位は不可
    expect(r.rivals).toHaveLength(6);
    expect(r.rankProbability).toBe(0);
  });

  it("実データ相当: 7 位 33,050pt から 3 位 170,710pt を残り 51h で抜く確率は低いが 0 ではない", () => {
    // 2026-09-25 のふわっち オータムグッズ（ぬいぐるみセット 秋冬フリー）の順位表（経過 69h）
    const start = new Date("2026-09-23T00:00:00+09:00");
    const at = "2026-09-25T20:53:00+09:00";
    const field = {
      p1: 513645, p2: 172250, p3: 170710, p4: 38570, p5: 36480, p6: 35180, me: 33050,
      p8: 15140, p9: 12020, p10: 10120, p11: 7780, p12: 4560, p13: 3200,
    };
    const r = forecastRank({
      snapshots: [snap(at, field)],
      eventStart: start,
      myKey: "me",
      myPoint: 0,
      myPaceMean: 0,
      myPaceStdDev: 0,
      targetRank: 3,
      now: new Date(at),
      endTime: new Date("2026-09-28T00:00:00+09:00"),
      iterations: 4000,
    });
    expect(r.currentRank).toBe(7);
    expect(r.currentPoint).toBe(33050);
    expect(r.rankProbability).toBeLessThan(15);
    expect(r.expectedRank).toBeGreaterThan(4);
    expect(r.expectedRank).toBeLessThan(9);
    expect(r.requiredPoints.p50).toBeGreaterThan(100_000);
  });
});

describe("itemsNeededFor", () => {
  it("ceil(必要pt / (基礎pt × 期待倍率))", () => {
    expect(itemsNeededFor(1000, 160, 1.95)).toBe(4); // 1000 / 312 = 3.2 → 4
    expect(itemsNeededFor(0, 160, 1.95)).toBe(0);
    expect(itemsNeededFor(100, 0, 1)).toBe(0);
  });
});
