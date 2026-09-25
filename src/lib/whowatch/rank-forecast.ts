// E3: ranking_snapshots からライバル別のペース分布を推定し、モンテカルロで
//   「目標順位に入る確率」「期待順位・順位分布」「必要追加ポイントの中央値／90%タイル」「必要アイテム個数」「1 日あたり個数」を返す。
// 純関数のみ。
//
// ペースモデル（2026-09-25 改訂）:
//   - ランキングに載っている全員（自分を含む）を同じ推定器で扱う。ライバルを目標周辺の数名に絞らない
//     （絞ると「シミュレーション上の順位」が実際の順位より良く出て、確率が過大になる）
//   - 各人の pt/時 は「直近スナップショットの増分平均」と「イベント開始からの平均（現在 pt ÷ 経過時間）」を
//     サンプル数で重み付けして混ぜる。スナップショットが 1 枚しか無くても、開始時刻が分かれば平均ペースで推定できる
//   - 残り時間の総獲得は pace × 残り時間 × m。m は対数正規（平均 1）の「今後のペース倍率」で、
//     サンプルが少ないほど散らばりを大きくする（ギフトは配信中に固まって入るため、線形の正規ノイズより実態に近い）
//   - 最終日（endTime 前 24h）はペース係数（既定 1.5）を掛けた実効残り時間を使う

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
  /** 最新スナップショットでの順位 */
  rank: number;
  currentPoint: number;
  /** pt/時（直近と全期間平均の混合） */
  paceMean: number;
  /** 表示用の散らばり（paceMean × rateSigma） */
  paceStdDev: number;
  /** 直近ウィンドウ内の増分サンプル数 */
  samples: number;
  /** 直近ウィンドウの平均 pt/時（サンプル無しなら null） */
  recentPace: number | null;
  /** イベント開始からの平均 pt/時（開始時刻不明なら null） */
  eventAvgPace: number | null;
  /** 今後のペース倍率（対数正規）の σ。小さいほど過去ペースが続く前提 */
  rateSigma: number;
}

export interface RankForecastInput {
  snapshots: SnapshotLike[];
  /** 自分の現在 pt（ランキング内に自分がいればそちらを優先） */
  myPoint: number;
  /** 自分がランキング外のときに使う予備のペース */
  myPaceMean: number;
  myPaceStdDev: number;
  targetRank: number;
  /** 現在時刻 */
  now: Date;
  endTime: Date;
  /** イベント開始時刻。あれば「現在 pt ÷ 経過時間」を各人のペース推定に使う */
  eventStart?: Date | null;
  /** 最終日（endTime 前 24h）のライバルペース係数。過去イベントから求まらなければ 1.5 を仮置き（TODO.md） */
  finalDayCoefficient?: number;
  iterations?: number;
  /** 必要個数の換算: アイテム 1 個の基礎 pt と期待倍率 */
  itemBasePoint?: number | null;
  expectedMultiplier?: number | null;
  /** 自分の識別（user_id → user_path → name） */
  myKey?: string | null;
}

export interface RankForecastOutput {
  rankProbability: number;
  /** 試行平均の最終順位 */
  expectedRank: number;
  bestRank: number;
  worstRank: number;
  /** 最終順位 → 試行数 */
  rankDistribution: Record<string, number>;
  /** 最新スナップショットでの自分の順位（ランキング外なら null） */
  currentRank: number | null;
  currentPoint: number;
  /** 自分の最終 pt 分布 */
  myFinalPoints: { p10: number; p50: number; p90: number };
  /** 自分のペース推定（ランキング外なら null） */
  myPace: RivalPace | null;
  /** 目標順位に入るのに必要な追加 pt（試行ごとの目標順位ボーダー − 自分の現在 pt）の分布 */
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
/** 直近ウィンドウの差分組数（5 分間隔なら 3 時間） */
const DEFAULT_MAX_PAIRS = 36;
/** 直近平均と全期間平均の重み: samples / (samples + RECENT_HALF_WEIGHT_SAMPLES) */
const RECENT_HALF_WEIGHT_SAMPLES = 12;
/** 全期間平均を使うのに必要な最小経過時間 */
const MIN_ELAPSED_HOURS = 0.5;

export function rivalKey(e: SnapshotEntry): string {
  return e.user_id ?? e.user_path ?? e.name;
}

/** 今後のペース倍率 σ: サンプル 0 で 0.7、12 で約 0.53、36 で約 0.45、288 で約 0.36 */
export function rateSigmaFor(samples: number): number {
  return Math.min(0.7, Math.max(0.3, 0.3 + 0.4 / Math.sqrt(1 + Math.max(0, samples) / 6)));
}

/** 平均 1 の対数正規倍率 */
export function rateMultiplier(sigma: number): number {
  if (sigma <= 0) return 1;
  return Math.exp(normalRandom(-(sigma * sigma) / 2, sigma));
}

function blendPace(recent: number | null, eventAvg: number | null, samples: number): number {
  if (recent === null && eventAvg === null) return 0;
  if (recent === null) return eventAvg as number;
  if (eventAvg === null) return recent;
  const w = samples / (samples + RECENT_HALF_WEIGHT_SAMPLES);
  return w * recent + (1 - w) * eventAvg;
}

/**
 * スナップショット列（時刻順）から、最新スナップショットに載っている全員の pt/時 を推定する。
 * - 直近 maxPairs 組の差分平均（recentPace）と、eventStart があれば全期間平均（eventAvgPace）を混ぜる
 * - eventStart が無く 2 枚未満なら推定不能として空を返す
 */
export function estimateRivalPaces(
  snapshots: SnapshotLike[],
  opts: { maxPairs?: number; excludeKey?: string | null; eventStart?: Date | null } = {},
): RivalPace[] {
  const sorted = [...snapshots].sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());
  if (sorted.length === 0) return [];
  const latest = sorted[sorted.length - 1];
  const latestAt = new Date(latest.capturedAt).getTime();
  const elapsedHours = opts.eventStart ? (latestAt - opts.eventStart.getTime()) / HOUR_MS : null;
  const canUseEventAvg = elapsedHours !== null && Number.isFinite(elapsedHours) && elapsedHours >= MIN_ELAPSED_HOURS;
  if (sorted.length < 2 && !canUseEventAvg) return [];

  const maxPairs = opts.maxPairs ?? DEFAULT_MAX_PAIRS;
  const start = Math.max(0, sorted.length - 1 - maxPairs);
  const paces = new Map<string, number[]>();

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
    }
  }

  const out: RivalPace[] = [];
  for (const e of latest.entries) {
    const k = rivalKey(e);
    if (opts.excludeKey && k === opts.excludeKey) continue;
    const arr = paces.get(k) ?? [];
    const recent = arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    const eventAvg = canUseEventAvg ? Math.max(0, e.point) / (elapsedHours as number) : null;
    const mean = blendPace(recent, eventAvg, arr.length);
    const sigma = rateSigmaFor(arr.length);
    out.push({
      key: k,
      name: e.name,
      rank: e.rank,
      currentPoint: e.point,
      paceMean: mean,
      paceStdDev: mean * sigma,
      samples: arr.length,
      recentPace: recent,
      eventAvgPace: eventAvg,
      rateSigma: sigma,
    });
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

/** 現在 pt だけで順位を決める（予測不能時・終了後） */
function currentRankOf(myPoint: number, rivals: RivalPace[]): number {
  return 1 + rivals.filter((r) => r.currentPoint >= myPoint).length;
}

export function forecastRank(input: RankForecastInput): RankForecastOutput {
  const iterations = input.iterations ?? 10_000;
  const coefficient = input.finalDayCoefficient ?? DEFAULT_FINAL_DAY_COEFFICIENT;
  const everyone = estimateRivalPaces(input.snapshots, { eventStart: input.eventStart ?? null });
  const myKey = input.myKey ?? null;
  const me = myKey ? everyone.find((r) => r.key === myKey) ?? null : null;
  const rivals = myKey ? everyone.filter((r) => r.key !== myKey) : everyone;
  const myPoint = me ? me.currentPoint : input.myPoint;
  // 自分がランキング外なら呼び出し側のペース（paceHistory 由来）を使う
  const myPaceMean = me ? me.paceMean : Math.max(0, input.myPaceMean);
  const mySigma = me
    ? me.rateSigma
    : myPaceMean > 0
      ? Math.min(0.7, Math.max(0.3, input.myPaceStdDev / myPaceMean))
      : 0.7;
  const { remainingHours, effectiveHours, finalDayHours } = effectiveRemainingHours(input.now, input.endTime, coefficient);
  const remainingDays = Math.max(1, Math.ceil(remainingHours / 24));
  const targetIdx = Math.max(0, input.targetRank - 1);
  const currentRank = me ? me.rank : null;

  if (rivals.length === 0 || remainingHours <= 0) {
    // 予測不能: 現状の順位で確定扱い
    const sortedNow = [...rivals].sort((a, b) => b.currentPoint - a.currentPoint);
    const border = sortedNow[targetIdx]?.currentPoint ?? 0;
    const required = Math.max(0, border + 1 - myPoint);
    const rankNow = rivals.length > 0 ? currentRankOf(myPoint, rivals) : currentRank ?? 1;
    return {
      rankProbability: rivals.length === 0 ? 0 : myPoint > border ? 100 : 0,
      expectedRank: rankNow,
      bestRank: rankNow,
      worstRank: rankNow,
      rankDistribution: { [String(rankNow)]: iterations },
      currentRank,
      currentPoint: myPoint,
      myFinalPoints: { p10: myPoint, p50: myPoint, p90: myPoint },
      myPace: me,
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
      note:
        rivals.length === 0
          ? "スナップショットが 2 枚未満（かつ開始時刻不明）のためライバルのペースを推定できません"
          : "イベント終了済み",
    };
  }

  let achieved = 0;
  let totalRank = 0;
  let bestRank = Infinity;
  let worstRank = 0;
  const distribution: Record<string, number> = {};
  const requiredSamples: number[] = [];
  const borderSamples: number[] = [];
  const myFinals: number[] = [];
  const finals = new Array<number>(rivals.length);

  for (let t = 0; t < iterations; t++) {
    const myFinal = myPoint + myPaceMean * effectiveHours * rateMultiplier(mySigma);
    let above = 0;
    for (let i = 0; i < rivals.length; i++) {
      const r = rivals[i];
      const f = r.currentPoint + r.paceMean * effectiveHours * rateMultiplier(r.rateSigma);
      finals[i] = f;
      if (f >= myFinal) above++; // 同点は先着優先のため相手が上
    }
    const myRank = above + 1;
    if (myRank <= input.targetRank) achieved++;
    totalRank += myRank;
    bestRank = Math.min(bestRank, myRank);
    worstRank = Math.max(worstRank, myRank);
    distribution[String(myRank)] = (distribution[String(myRank)] ?? 0) + 1;
    myFinals.push(myFinal);

    const sortedFinals = [...finals].sort((a, b) => b - a);
    // 目標順位に入る = 自分が「targetRank 位のライバル最終 pt」を超える（同点は先着優先のため +1）
    const border = sortedFinals[targetIdx] ?? 0;
    borderSamples.push(border);
    requiredSamples.push(Math.max(0, border + 1 - myPoint));
  }
  requiredSamples.sort((a, b) => a - b);
  borderSamples.sort((a, b) => a - b);
  myFinals.sort((a, b) => a - b);
  const reqP50 = percentile(requiredSamples, 0.5);
  const reqP90 = percentile(requiredSamples, 0.9);

  return {
    rankProbability: (achieved / iterations) * 100,
    expectedRank: totalRank / iterations,
    bestRank: bestRank === Infinity ? 1 : bestRank,
    worstRank,
    rankDistribution: distribution,
    currentRank,
    currentPoint: myPoint,
    myFinalPoints: { p10: percentile(myFinals, 0.1), p50: percentile(myFinals, 0.5), p90: percentile(myFinals, 0.9) },
    myPace: me,
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
    note: "ランキング全員の pt/時（直近の増分と開始からの平均の混合）から推定。期待値・目安であり結果を保証しない",
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
