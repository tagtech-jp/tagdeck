// イベント攻略の計算コア（R2: 効率計算 / R3: 逆算 / R8: 順位↔スコア推定）。
// calculator.ts / monte-carlo.ts と同じく純関数のみ。I/O・外部アクセスは一切行わない。
// 全ての提案は期待値・目安であり断定しない（disclaimer/note に明示）。

import type { EventTypeTemplate } from "./event-templates";
import type { RivalState } from "./monte-carlo";

// ── R2: アイテム効率 ─────────────────────────────────────────────

export interface ItemMasterEntry {
  itemId: string;
  name: string;
  basePoint: number;
  priceJpy: number;
}

export interface ItemEfficiency {
  itemId: string;
  name: string;
  basePoint: number;
  priceJpy: number;
  multiplier: number;
  effectivePt: number;
  ptPerYen: number;
  /** 倍率・効率は全てテンプレ由来の仮定値であることを示すフラグ（常にtrue） */
  isAssumption: true;
  templateLabel: string;
  ceoConfirmedAt: string | null;
}

/**
 * アイテムをイベント倍率込みの効率（pt/円）でランキングする。
 * pt/円は同期処理でbasePoint≒priceJpyのため実質「倍率」に収束する（Step1調査で確認済み）。
 * priceJpy<=0（フォールバック等）はbasePointを円換算の代用とする。
 */
export function rankItemsByEfficiency(
  items: ItemMasterEntry[],
  template: EventTypeTemplate
): ItemEfficiency[] {
  return items
    .map((item): ItemEfficiency => {
      const multiplier = template.itemMultipliers?.[item.itemId] ?? template.defaultMultiplier;
      const effectivePt = item.basePoint * multiplier;
      const yenBasis = item.priceJpy > 0 ? item.priceJpy : item.basePoint;
      const ptPerYen = yenBasis > 0 ? effectivePt / yenBasis : 0;
      return {
        itemId: item.itemId,
        name: item.name,
        basePoint: item.basePoint,
        priceJpy: item.priceJpy,
        multiplier,
        effectivePt,
        ptPerYen,
        isAssumption: true,
        templateLabel: template.label,
        ceoConfirmedAt: template.ceoConfirmedAt,
      };
    })
    .sort((a, b) => b.ptPerYen - a.ptPerYen || a.basePoint - b.basePoint);
}

// ── R3: 逆算（目標→必要スコア→アイテム構成） ─────────────────────

export interface RivalProjection {
  name: string;
  currentScore: number;
  finalP50: number;
  finalP90: number;
}

const Z_SCORE_P90 = 1.2816;

/**
 * 既存モンテカルロ(simulateRankingProbability)と同一モデル（自分/ライバルとも
 * 単一正規乱数draw×残り時間・分散はHに線形）を閉形式で再利用したライバル最終スコア投影。
 * 新たなシミュレーションループを追加しない（既存エンジンとの整合を優先）。
 */
export function projectRivalFinals(
  rivals: RivalState[],
  remainingHours: number
): RivalProjection[] {
  return rivals.map((r) => ({
    name: r.name,
    currentScore: r.currentScore,
    finalP50: r.currentScore + Math.max(0, r.paceMean * remainingHours),
    finalP90: r.currentScore + Math.max(0, (r.paceMean + Z_SCORE_P90 * r.paceStdDev) * remainingHours),
  }));
}

export type ReverseTargetResult =
  | { kind: "insufficient_data"; reason: string }
  | {
      kind: "estimate";
      requiredAdditionalPt: { p50: number; p90: number };
      targetFinalScore: { p50: number; p90: number } | null;
      disclaimer: string;
    };

export interface ScoreGoalInput {
  kind: "score";
  targetScore: number;
  currentScore: number;
}

export interface RankingGoalInput {
  kind: "ranking";
  targetRank: number;
  currentScore: number;
  paceMean: number;
  paceStdDev: number;
  paceHistoryLength: number;
  /** rivalsSnapshot由来（extractRivalsの±3近傍窓）。myEntryは含めない */
  rivals: RivalState[];
  remainingHours: number;
  /** extractRivals().myEntry !== null か（名前不一致だとfalse） */
  myEntryFound: boolean;
  /** 安全マージン。既定2%（要確認） */
  bufferRatio?: number;
}

export type GoalInput = ScoreGoalInput | RankingGoalInput;

const COLD_START_PACE_MEAN = 0;
const COLD_START_PACE_STDDEV = 100;
const MIN_PACE_HISTORY_POINTS = 3;
const DEFAULT_BUFFER_RATIO = 0.02; // (要確認)

/**
 * 目標（順位 or スコア）から必要な追加スコアを逆算する。
 * コールドスタート（ペース未推定）や順位窓外など、捏造数値になりうるケースは
 * 全て insufficient_data を返す（呼び出し側は「データ蓄積中」等の正直な表示に使うこと）。
 */
export function computeReverseTarget(input: GoalInput): ReverseTargetResult {
  if (input.kind === "score") {
    const requiredAdditionalPt = Math.max(0, input.targetScore - input.currentScore);
    return {
      kind: "estimate",
      requiredAdditionalPt: { p50: requiredAdditionalPt, p90: requiredAdditionalPt },
      targetFinalScore: null,
      disclaimer: "目標スコアとの単純差分（目安）です。",
    };
  }

  if (!input.myEntryFound) {
    return { kind: "insufficient_data", reason: "自分のエントリを特定できません" };
  }

  const isColdStart =
    input.paceHistoryLength < MIN_PACE_HISTORY_POINTS ||
    (input.paceMean === COLD_START_PACE_MEAN && input.paceStdDev === COLD_START_PACE_STDDEV);
  if (isColdStart) {
    return {
      kind: "insufficient_data",
      reason: "データ蓄積中：ペース推定に約3分（3データ点）必要です",
    };
  }

  const bufferRatio = input.bufferRatio ?? DEFAULT_BUFFER_RATIO;
  const projections = projectRivalFinals(input.rivals, input.remainingHours);
  const idx = input.targetRank - 1;

  const byP50 = [...projections].sort((a, b) => b.finalP50 - a.finalP50);
  const byP90 = [...projections].sort((a, b) => b.finalP90 - a.finalP90);
  const thresholdP50 = byP50[idx];
  const thresholdP90 = byP90[idx];

  if (!thresholdP50 || !thresholdP90) {
    // 目標順位がextractRivalsの±3近傍窓外 → 外挿せず「一つ上を抜く」増分目安にフォールバック
    const nextAbove = byP50[0];
    if (!nextAbove) {
      return { kind: "insufficient_data", reason: "目標順位の周辺データがありません" };
    }
    const target = nextAbove.finalP50 * (1 + bufferRatio);
    const requiredAdditionalPt = Math.max(0, target - input.currentScore);
    return {
      kind: "estimate",
      requiredAdditionalPt: { p50: requiredAdditionalPt, p90: requiredAdditionalPt },
      targetFinalScore: { p50: target, p90: target },
      disclaimer:
        "目標順位が取得範囲外のため、まず一つ上（直近上位）を抜く目安として算出しています。",
    };
  }

  const targetP50 = thresholdP50.finalP50 * (1 + bufferRatio);
  const targetP90 = thresholdP90.finalP90 * (1 + bufferRatio);

  return {
    kind: "estimate",
    requiredAdditionalPt: {
      p50: Math.max(0, targetP50 - input.currentScore),
      p90: Math.max(0, targetP90 - input.currentScore),
    },
    targetFinalScore: { p50: targetP50, p90: targetP90 },
    disclaimer: "ライバルのペースを基にした期待値・目安です。実際の結果を保証するものではありません。",
  };
}

// ── アイテム構成の提案 ────────────────────────────────────────────

export interface ItemPlan {
  itemId: string;
  name: string;
  multiplier: number;
  effectivePt: number;
  countP50: number;
  countP90: number;
  note: string;
}

/** 必要追加ptを上位N効率アイテムで割った「約N個相当（目安）」の構成案を返す。命令形は使わない。 */
export function composeItemPlan(
  requiredAdditionalPt: { p50: number; p90: number },
  ranked: ItemEfficiency[],
  topN = 3
): ItemPlan[] {
  return ranked.slice(0, topN).map((item) => {
    const countP50 = item.effectivePt > 0 ? Math.ceil(requiredAdditionalPt.p50 / item.effectivePt) : 0;
    const countP90 = item.effectivePt > 0 ? Math.ceil(requiredAdditionalPt.p90 / item.effectivePt) : 0;
    return {
      itemId: item.itemId,
      name: item.name,
      multiplier: item.multiplier,
      effectivePt: item.effectivePt,
      countP50,
      countP90,
      note: `約${countP50}〜${countP90}個相当（目安・倍率は仮定値のため${item.ceoConfirmedAt ? "" : "未確認"}）`,
    };
  });
}
