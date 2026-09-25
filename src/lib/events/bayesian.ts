// 経験ベイズ (案A) によるペース事後推定 — Normal-Normal 共役更新
// 設計書: docs/architecture/phase5b-bayesian-design.md

const PRIOR_STRENGTH = 3; // k₀: 現在セッションへの仮想サンプル数

export interface EmpiricalBayesInput {
  currentMean: number;
  currentStd: number;
  historicalMean: number;
  historicalStd: number;
  sampleCount: number;
}

export interface EmpiricalBayesOutput {
  posteriorMean: number;
  posteriorStd: number;
}

function isValid(v: number): boolean {
  return Number.isFinite(v) && v >= 0;
}

/** 経験ベイズによるペース事後分布を解析解で返す。
 *  sampleCount=0 または異常値の場合は Phase 5a フォールバック（current* をそのまま返す）。
 *
 *  μ_post = (k₀ × μ_current + n × μ_hist) / (k₀ + n)
 *  σ_post = σ_hist × √(k₀ / (k₀ + n))
 */
export function applyEmpiricalBayes(input: EmpiricalBayesInput): EmpiricalBayesOutput {
  const { currentMean, currentStd, historicalMean, historicalStd, sampleCount } = input;

  if (
    sampleCount === 0 ||
    !isValid(currentMean) ||
    !isValid(currentStd) ||
    !isValid(historicalMean) ||
    !isValid(historicalStd)
  ) {
    return { posteriorMean: currentMean, posteriorStd: currentStd };
  }

  const n = sampleCount;
  const posteriorMean =
    (PRIOR_STRENGTH * currentMean + n * historicalMean) / (PRIOR_STRENGTH + n);
  const posteriorStd =
    historicalStd * Math.sqrt(PRIOR_STRENGTH / (PRIOR_STRENGTH + n));

  return {
    posteriorMean,
    posteriorStd: Math.max(posteriorStd, posteriorMean * 0.05),
  };
}
