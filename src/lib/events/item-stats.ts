// アイテム 1 個あたりの獲得量（pt や kg）の分布と、「あと何個で足りるか」の統計（2026-10-07 社長指示
// 「仕様はイベント毎に違うので何個平均で必要かなどの情報をダッシュボードに出すこと。統計を駆使して現実的な解を」）。
// 純関数のみ。I/O はしない。
//
// イベントごとにルールが違う:
//   - 倍率表型（例: マジックファンタジー）: 1 個 = 基礎 pt × 倍率。倍率は「1% で 20 倍、4% で 10 倍、…」の表（rules-parser の multiplierTable）
//   - 重量表型（例: 黄金発掘隊）: 1 個 = 掘れた金塊の重量 kg。「0.1% で 500 kg〜、3.9% で 300〜499 kg、…」の表（rules-parser の valueTable）。
//     範囲内は一様と仮定。上限の無い段（500 kg〜）は下限の 2 倍まで（500〜999）と仮定する（出現率 0.1% なので平均への影響は 1 kg 未満）
// 必要個数は「合計が足りない量に達するまで 1 個ずつ引く」試行をモンテカルロで回し、中央値と 90% タイルを出す。
// 平均で割るだけの計算（必要量 ÷ 平均）は、ばらつきの大きい表で楽観的になる
// （黄金発掘隊は 1 個の標準偏差（約 94 kg）が平均（約 85 kg）より大きい。1,000 kg 足りないとき平均なら 12 個、90% の確からしさなら 19 個前後）。

export interface ValueTier {
  /** 0〜100 の % */
  probability: number;
  min: number;
  /** 上限。無ければ null（開いた段） */
  max: number | null;
  label?: string | null;
}

export type ItemValueDistribution =
  | { kind: "multiplier"; basePoint: number; table: ReadonlyArray<{ probability: number; multiplier: number }> }
  | { kind: "range"; unit: string | null; tiers: readonly ValueTier[] };

/** 開いた段（500 kg〜）の上限の仮定: 下限 × この倍率 − 1（500 → 999） */
export const OPEN_ENDED_MAX_RATIO = 2;

export interface ItemsNeededStats {
  /** 必要量 ÷ 平均（小数のまま） */
  mean: number;
  /** 試行の中央値（整数個） */
  p50: number;
  /** 試行の 90% タイル（この個数あれば 9 割の試行で足りた） */
  p90: number;
  iterations: number;
}

export interface ItemValueSummary {
  mean: number;
  sd: number;
  median: number;
  /** 分布の下 10% / 上 10% */
  p10: number;
  p90: number;
  unit: string | null;
}

export type Rng = () => number;

/** 段の実際の下限・上限（開いた段は仮定で閉じる） */
export function tierBounds(t: ValueTier): { min: number; max: number } {
  const min = Math.max(0, t.min);
  const max = t.max !== null && t.max >= min ? t.max : Math.max(min, min * OPEN_ENDED_MAX_RATIO - 1);
  return { min, max };
}

interface Outcome {
  /** 0〜1 */
  p: number;
  min: number;
  max: number;
}

/** 分布を「確率・下限・上限」の並び（値の昇順）にする。確率の合計が 100 でなくても正規化する */
function outcomesOf(dist: ItemValueDistribution): Outcome[] {
  const raw: Outcome[] =
    dist.kind === "multiplier"
      ? dist.table.filter((r) => r.probability > 0).map((r) => ({ p: r.probability, min: dist.basePoint * r.multiplier, max: dist.basePoint * r.multiplier }))
      : dist.tiers.filter((t) => t.probability > 0).map((t) => ({ p: t.probability, ...tierBounds(t) }));
  const total = raw.reduce((a, o) => a + o.p, 0);
  if (total <= 0) return [];
  return raw.map((o) => ({ ...o, p: o.p / total })).sort((a, b) => a.min - b.min || a.max - b.max);
}

/** 何度も引くときのために前計算した分布 */
export interface CompiledDistribution {
  mean: number;
  sd: number;
  unit: string | null;
  /** 1 個ぶんを引く。重量表は段を選んでから範囲内の整数を一様に、倍率表は基礎 pt × 倍率 */
  sample: (rng: Rng) => number;
}

export function compileDistribution(dist: ItemValueDistribution): CompiledDistribution | null {
  const os = outcomesOf(dist);
  if (os.length === 0) return null;
  const mean = os.reduce((a, o) => a + o.p * ((o.min + o.max) / 2), 0);
  // 段の中は一様分布として E[X²] = (a² + ab + b²) / 3
  const ex2 = os.reduce((a, o) => a + o.p * ((o.min * o.min + o.min * o.max + o.max * o.max) / 3), 0);
  const sd = Math.sqrt(Math.max(0, ex2 - mean * mean));
  const sample = (rng: Rng): number => {
    let r = rng();
    let chosen = os[os.length - 1];
    for (const o of os) {
      if (r < o.p) {
        chosen = o;
        break;
      }
      r -= o.p;
    }
    if (chosen.max <= chosen.min) return chosen.min;
    return chosen.min + Math.floor(rng() * (chosen.max - chosen.min + 1));
  };
  return { mean, sd, unit: dist.kind === "range" ? dist.unit : "pt", sample };
}

/** 1 個あたりの平均（表が空なら 0） */
export function itemValueMean(dist: ItemValueDistribution): number {
  return compileDistribution(dist)?.mean ?? 0;
}

/** 1 個あたりの標準偏差（表が空なら 0） */
export function itemValueSd(dist: ItemValueDistribution): number {
  return compileDistribution(dist)?.sd ?? 0;
}

/** 分布の分位点（段の中は一様として線形補間） */
export function itemValueQuantile(dist: ItemValueDistribution, q: number): number {
  const os = outcomesOf(dist);
  if (os.length === 0) return 0;
  const target = Math.min(1, Math.max(0, q));
  let acc = 0;
  for (const o of os) {
    if (acc + o.p >= target) {
      const within = o.p > 0 ? (target - acc) / o.p : 0;
      return o.min + (o.max - o.min) * within;
    }
    acc += o.p;
  }
  return os[os.length - 1].max;
}

export function summarizeItemValue(dist: ItemValueDistribution): ItemValueSummary {
  const c = compileDistribution(dist);
  return {
    mean: c?.mean ?? 0,
    sd: c?.sd ?? 0,
    median: itemValueQuantile(dist, 0.5),
    p10: itemValueQuantile(dist, 0.1),
    p90: itemValueQuantile(dist, 0.9),
    unit: dist.kind === "range" ? dist.unit : "pt",
  };
}

/** 決定的な乱数（テスト用・mulberry32） */
export function seededRandom(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 1 個ぶんを引く（1 回だけなら前計算なしで） */
export function sampleItemValue(dist: ItemValueDistribution, rng: Rng = Math.random): number {
  return compileDistribution(dist)?.sample(rng) ?? 0;
}

/** 必要量に達するまで引いた個数（上限 maxItems で打ち切り）。平均 0 の分布は maxItems */
export function drawsUntil(gap: number, dist: ItemValueDistribution | CompiledDistribution, rng: Rng, maxItems = 5000): number {
  if (!(gap > 0)) return 0;
  const c = "sample" in dist ? dist : compileDistribution(dist);
  if (!c || !(c.mean > 0)) return maxItems;
  let sum = 0;
  let n = 0;
  while (sum < gap && n < maxItems) {
    sum += c.sample(rng);
    n++;
  }
  return n;
}

function percentileOfSorted(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(sortedAsc.length * p)));
  return sortedAsc[idx];
}

/**
 * 足りない量（gap）に対する必要個数の統計。平均が 0 以下（表が空）なら null。
 * iterations は既定 2,000（1,000 kg 足りないときの 1 回の試行は十数回の引き直し。十分速い）
 */
export function itemsNeededStats(gap: number, dist: ItemValueDistribution, opts: { iterations?: number; rng?: Rng; maxItems?: number } = {}): ItemsNeededStats | null {
  const c = compileDistribution(dist);
  if (!c || !(c.mean > 0)) return null;
  const iterations = Math.max(1, Math.floor(opts.iterations ?? 2000));
  if (!(gap > 0)) return { mean: 0, p50: 0, p90: 0, iterations };
  const rng = opts.rng ?? Math.random;
  const counts = new Array<number>(iterations);
  for (let i = 0; i < iterations; i++) counts[i] = drawsUntil(gap, c, rng, opts.maxItems);
  counts.sort((a, b) => a - b);
  return { mean: gap / c.mean, p50: percentileOfSorted(counts, 0.5), p90: percentileOfSorted(counts, 0.9), iterations };
}

/** rules-parser の valueTable（重量表）→ 分布。表が無ければ null */
export function distributionFromValueTable(
  table: ReadonlyArray<{ probability: number; min: number; max: number | null; label?: string | null }> | null | undefined,
  unit: string | null | undefined,
): ItemValueDistribution | null {
  if (!table || table.length === 0) return null;
  return { kind: "range", unit: unit ?? null, tiers: table.map((t) => ({ probability: t.probability, min: t.min, max: t.max, label: t.label ?? null })) };
}

/** rules-parser の multiplierTable（倍率表）と基礎 pt → 分布。表が無ければ倍率 1 の 1 段。基礎 pt が無ければ null */
export function distributionFromMultiplierTable(
  table: ReadonlyArray<{ probability: number; multiplier: number }> | null | undefined,
  basePoint: number | null | undefined,
): ItemValueDistribution | null {
  if (!basePoint || basePoint <= 0) return null;
  return { kind: "multiplier", basePoint, table: table && table.length > 0 ? table : [{ probability: 100, multiplier: 1 }] };
}
