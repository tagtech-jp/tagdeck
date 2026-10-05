// 学習単価（learned_point）と定価（price_jpy）の答え合わせ（純関数・2026-10-05）。
//
// 背景（社長指示「学習した単価の答え合わせ」・公開範囲は「自前ツール向けだけ」）:
//   learned_point は配信者が実際に受け取った 1 個あたりのポイント、price_jpy は 1 個あたりの定価（円）。
//   普段は「ポイント ÷ 円」がどのアイテムでもほぼ同じ比率になるはずなので、その比率が全体の中央値から
//   大きくずれているアイテムは、イベントの倍率・定価の誤り・学習の誤りのどれかを疑う手がかりになる。
//   運営者の実際の収益の比率にあたるため、items/export が X-Sync-Key で呼ばれたときだけ返す（画面には出さない）。

import type { ExportItem } from "./item-export";

/** 観測回数がこれ未満の学習単価は、比率の中央値にも外れ値の判定にも使わない */
export const LEARNED_GAP_MIN_SAMPLES = 3;
/** 中央値の比率から何割ずれたら一覧に出すか */
export const LEARNED_GAP_THRESHOLD = 0.2;
/** 中央値を出すのに必要な件数 */
const MIN_ITEMS_FOR_MEDIAN = 3;

export type LearnedGapReason = "higher" | "lower" | "free_with_points";

export interface LearnedGap {
  item_id: string;
  item_name: string;
  event_key: string | null;
  price_jpy: number;
  learned_point: number;
  learned_samples: number;
  /** 定価と中央値の比率から見込んだ 1 個あたりのポイント（無料は null） */
  expected_point: number | null;
  /** 中央値の比率からのずれ（%）。+50 は見込みの 1.5 倍、無料は null */
  deviation_pct: number | null;
  reason: LearnedGapReason;
}

export interface LearnedGapSummary {
  /** ポイント ÷ 円 の中央値（件数が足りなければ null） */
  median_point_per_jpy: number | null;
  /** 比較に使えたアイテム数（観測 LEARNED_GAP_MIN_SAMPLES 回以上・定価あり） */
  compared: number;
  min_samples: number;
  threshold_pct: number;
  /** ずれの大きい順 */
  gaps: LearnedGap[];
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

export function summarizeLearnedGaps(items: readonly ExportItem[]): LearnedGapSummary {
  const learned = items.filter((it) => it.learned_point !== null && it.learned_point !== undefined && (it.learned_samples ?? 0) >= LEARNED_GAP_MIN_SAMPLES);
  const priced = learned.filter((it) => it.price_jpy > 0);
  const med = priced.length >= MIN_ITEMS_FOR_MEDIAN ? median(priced.map((it) => it.learned_point! / it.price_jpy)) : null;

  const gaps: LearnedGap[] = [];
  for (const it of learned) {
    const base = { item_id: it.item_id, item_name: it.item_name, event_key: it.event_key, price_jpy: it.price_jpy, learned_point: it.learned_point!, learned_samples: it.learned_samples ?? 0 };
    if (it.price_jpy <= 0) {
      if (it.learned_point! > 0) gaps.push({ ...base, expected_point: null, deviation_pct: null, reason: "free_with_points" });
      continue;
    }
    if (med === null || med <= 0) continue;
    const expected = it.price_jpy * med;
    const deviation = it.learned_point! / expected - 1;
    // ちょうど 2 割を小数の誤差で取りこぼさないよう、比べる前に丸める
    if (Math.abs(round(deviation, 6)) < LEARNED_GAP_THRESHOLD) continue;
    gaps.push({ ...base, expected_point: round(expected, 2), deviation_pct: round(deviation * 100, 1), reason: deviation > 0 ? "higher" : "lower" });
  }
  // 無料なのにポイントが付くものを先に、あとはずれの大きい順
  gaps.sort((a, b) => Number(b.reason === "free_with_points") - Number(a.reason === "free_with_points") || Math.abs(b.deviation_pct ?? 0) - Math.abs(a.deviation_pct ?? 0));
  return { median_point_per_jpy: med === null ? null : round(med, 4), compared: priced.length, min_samples: LEARNED_GAP_MIN_SAMPLES, threshold_pct: LEARNED_GAP_THRESHOLD * 100, gaps };
}
