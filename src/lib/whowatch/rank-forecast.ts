// E3: ranking_snapshots からライバル別のペース分布を推定し、モンテカルロで
//   「目標順位に入る確率」「必要追加ポイントの中央値／90%タイル」「必要アイテム個数」「1 日あたり個数」を返す。
// 既存 monte-carlo.ts と同じモデル（正規乱数 × 残り時間）を、ライバル個別ペース + 最終日係数で拡張する。純関数のみ。

import { normalRandom } from "../events/monte-carlo";

export interface SnapshotEntry {
  rank: number;
  point: number;
  user_id: string | null;
  user_path: string | null;
  name: string;
}
export interface SnapshotLike {
  capturedAt: string | Date;
  entries: SnapshotEntry[];
  myPoint?: number | null;
}

export interface RivalPace {
  key: string;
  name: string;
  currentPoint: number;
  /** pt/時 */
  paceMean: number;
  paceStdDev: number;
  samples: number;
}

export interface RankForecastInput {
  snapshots: SnapshotLike[];
  /** 自分の現在 pt（スナップショットの my_point か、ランキング外なら 0） */
  myPoint: number;
  myPaceMean: number;
  myPaceStdDev: number;
  targetRank: number;
  /** 現在時刻 */
  now: Date;
  endTime: Date;
  /** 最終日（endTime 前 24h）のライバルペース係数。過去イベントから求まらなければ 1.5 を仮置き（TODO.md） */
  finalDayCoefficient?: number;
  iterations?: number;
  /** 必要個数の換算: アイテム 1 個の基礎 pt と期待倍率 */
  itemBasePoint?: number | null;
  expectedMultiplier?: number | null;
  /** 自分の識別（ライバル集合から除くため） */
  myKey?: string | null;
}

export interface RankForecastOutput {
  rankProbability: number;
  /** 目標順位に入るのに必要な追加 pt（試行ごとの目標順位ボーダー − 自分の最終 pt 期待）の分布 */
  requiredPoints: { p50: number; p90: number };
  targetBorderPoints: { p50: number; p90: number };
  itemsNeeded: { p50: number; p90: number } | null;
  itemsPerDay: { p50: number; p90: number } | null;
  remainingHours: number;
  remainingDays: number;
  rivals: RivalPace[];
  finalDayCoefficient: number;
  usedFinalDayCoefficient: boolean;
  snapshotCount: number;
  note: string;
}

export const DEFAULT_FINAL_DAY_COEFFICIENT = 1.5; // (要確認) 過去 closed イベントの伸び率係数が無い場合の仮置き
const HOUR_MS = 3_600_000;

function rivalKey(e: SnapshotEntry): string {
  return e.user_id ?? e.user_path ?? e.name;
}

/**
 * スナップショット列（時刻順）から、各ライバルの pt/時 の平均と標準偏差を推定する。
 * 直近 maxPairs 組の差分を使う。2 枚未満なら空。
 */
export function estimateRivalPaces(snapshots: SnapshotLike[], opts: { maxPairs?: number; excludeKey?: string | null } = {}): RivalPace[] {
  const sorted = [...snapshots].sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());
  if (sorted.length < 2) return [];
  const maxPairs = opts.maxPairs ?? 24;
  const start = Math.max(0, sorted.length - 1 - maxPairs);
  const latest = sorted[sorted.length - 1];
  const paces = new Map<string, number[]>();
  const names = new Map<string, string>();

  for (let i = start + 1; i < sorted.length; i++) {
    const prev = new Map(sorted[i - 1].entries.map((e) => [rivalKey(e), e]));
    const dtH = (new Date(sorted[i].capturedAt).getTime() - new Date(sorted[i - 1].capturedAt).getTime()) / HOUR_MS;
    if (dtH <= 0) continue;
    for (const e of sorted[i].entries) {
      const k = rivalKey(e);
      const p = prev.get(k);
      if (!p) continue;
      const dp = e.point - p.point;
      if (dp < 0) continue; // 減点は無視（表示揺れ）
      if (!paces.has(k)) paces.set(k, []);
      paces.get(k)!.push(dp / dtH);
      names.set(k, e.name);
    }
  }

  const out: RivalPace[] = [];
  for (const e of latest.entries) {
    const k = rivalKey(e);
    if (opts.excludeKey && k === opts.excludeKey) continue;
    const arr = paces.get(k) ?? [];
    const mean = arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const variance = arr.length > 1 ? arr.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (arr.length - 1) : 0;
    // 分散が 0（データ 1 組など）でも最低限の揺らぎを持たせる（既存 estimatePaceParameters と同じ mean×0.1 下限）
    const stdDev = Math.max(Math.sqrt(variance), mean * 0.1, arr.length === 0 ? 0 : 1);
    out.push({ key: k, name: e.name, currentPoint: e.point, paceMean: mean, paceStdDev: stdDev, samples: arr.length });
  }
  return out;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(sortedAsc.length * p)));
  return sortedAsc[idx];
}

/**
 * 残り時間のうち最終日（endTime 前 24h）に重なる時間だけ係数を掛けた「実効残り時間」を返す。
 */
export function effectiveRemainingHours(now: Date, endTime: Date, coefficient: number): { remainingHours: number; effectiveHours: number; finalDayHours: number } {
  const remainingHours = Math.max(0, (endTime.getTime() - now.getTime()) / HOUR_MS);
  const finalDayStart = endTime.getTime() - 24 * HOUR_MS;
  const finalDayHours = Math.max(0, (endTime.getTime() - Math.max(now.getTime(), finalDayStart)) / HOUR_MS);
  const normalHours = remainingHours - finalDayHours;
  return { remainingHours, effectiveHours: normalHours + finalDayHours * coefficient, finalDayHours };
}

export function forecastRank(input: RankForecastInput): RankForecastOutput {
  const iterations = input.iterations ?? 10_000;
  const coefficient = input.finalDayCoefficient ?? DEFAULT_FINAL_DAY_COEFFICIENT;
  const rivals = estimateRivalPaces(input.snapshots, { excludeKey: input.myKey ?? null });
  const { remainingHours, effectiveHours, finalDayHours } = effectiveRemainingHours(input.now, input.endTime, coefficient);
  const remainingDays = Math.max(1, Math.ceil(remainingHours / 24));
  const targetIdx = Math.max(0, input.targetRank - 1);

  if (rivals.length === 0 || remainingHours <= 0) {
    // 予測不能: 現状の順位で確定扱い
    const border = rivals[targetIdx]?.currentPoint ?? 0;
    const required = Math.max(0, border - input.myPoint);
    return {
      rankProbability: input.myPoint > border ? 100 : 0,
      requiredPoints: { p50: required, p90: required },
      targetBorderPoints: { p50: border, p90: border },
      itemsNeeded: toItems(required, required, input),
      itemsPerDay: toItems(required, required, input, remainingDays),
      remainingHours,
      remainingDays,
      rivals,
      finalDayCoefficient: coefficient,
      usedFinalDayCoefficient: finalDayHours > 0,
      snapshotCount: input.snapshots.length,
      note: rivals.length === 0 ? "スナップショットが 2 枚未満のためライバルのペースを推定できません" : "イベント終了済み",
    };
  }

  let achieved = 0;
  const requiredSamples: number[] = [];
  const borderSamples: number[] = [];
  for (let t = 0; t < iterations; t++) {
    const myFinal = input.myPoint + Math.max(0, normalRandom(input.myPaceMean, input.myPaceStdDev) * effectiveHours);
    const finals = rivals.map((r) => r.currentPoint + Math.max(0, normalRandom(r.paceMean, r.paceStdDev) * effectiveHours));
    finals.sort((a, b) => b - a);
    // 目標順位に入る = 自分が「targetRank 位のライバル最終 pt」を超える（同点は先着優先のため +1）
    const border = finals[targetIdx] ?? 0;
    if (myFinal > border) achieved++;
    borderSamples.push(border);
    requiredSamples.push(Math.max(0, border + 1 - input.myPoint));
  }
  requiredSamples.sort((a, b) => a - b);
  borderSamples.sort((a, b) => a - b);
  const reqP50 = percentile(requiredSamples, 0.5);
  const reqP90 = percentile(requiredSamples, 0.9);

  return {
    rankProbability: (achieved / iterations) * 100,
    requiredPoints: { p50: reqP50, p90: reqP90 },
    targetBorderPoints: { p50: percentile(borderSamples, 0.5), p90: percentile(borderSamples, 0.9) },
    itemsNeeded: toItems(reqP50, reqP90, input),
    itemsPerDay: toItems(reqP50, reqP90, input, remainingDays),
    remainingHours,
    remainingDays,
    rivals,
    finalDayCoefficient: coefficient,
    usedFinalDayCoefficient: finalDayHours > 0,
    snapshotCount: input.snapshots.length,
    note: "ライバルは直近スナップショットの pt 増分から推定した正規分布ペース。期待値・目安であり結果を保証しない",
  };
}

function toItems(p50: number, p90: number, input: RankForecastInput, days = 1): { p50: number; p90: number } | null {
  const base = input.itemBasePoint ?? null;
  const mult = input.expectedMultiplier ?? 1;
  if (!base || base <= 0) return null;
  const per = base * mult;
  return { p50: Math.ceil(p50 / per / days), p90: Math.ceil(p90 / per / days) };
}

/** 必要個数の単体計算（UI の手入力用） */
export function itemsNeededFor(requiredPoints: number, basePoint: number, expectedMultiplierValue: number): number {
  if (basePoint <= 0) return 0;
  return Math.ceil(requiredPoints / (basePoint * Math.max(expectedMultiplierValue, 1e-9)));
}
