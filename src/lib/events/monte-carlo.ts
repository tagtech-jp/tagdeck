/**
 * モンテカルロシミュレーションによる順位達成確率計算
 *
 * 自分とライバルのペースを正規分布でモデル化し、
 * 10,000 試行で目標順位以内に入る確率を算出する。
 * クライアント側で実行（サーバー負荷削減）。
 */

export interface RivalState {
  name: string;
  currentScore: number;
  paceMean: number;    // 時速平均
  paceStdDev: number;  // 時速標準偏差
}

export interface MonteCarloInput {
  myCurrentScore: number;
  myPaceMean: number;
  myPaceStdDev: number;
  rivals: RivalState[];
  remainingHours: number;
  targetRank: number;
  iterations?: number;
}

export interface MonteCarloOutput {
  rankProbability: number;       // 目標順位以内の確率（0〜100）
  expectedRank: number;          // 平均順位
  bestRank: number;              // 最良順位
  worstRank: number;             // 最悪順位
  rankDistribution: Record<string, number>; // 順位 → 試行数
  myFinalScoreDistribution: {
    p10: number;
    p50: number;
    p90: number;
    mean: number;
  };
}

/** Box-Muller 変換による正規乱数生成（rank-forecast.ts でも再利用） */
export function normalRandom(mean: number, stdDev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
  return z0 * stdDev + mean;
}

/** モンテカルロシミュレーション実行 */
export function simulateRankingProbability(input: MonteCarloInput): MonteCarloOutput {
  const iterations = input.iterations ?? 10000;

  if (input.remainingHours <= 0) {
    // イベント終了済み：現在スコアで順位確定
    const allScores = [
      { score: input.myCurrentScore, isMe: true },
      ...input.rivals.map((r) => ({ score: r.currentScore, isMe: false })),
    ];
    allScores.sort((a, b) => b.score - a.score);
    const myRank = allScores.findIndex((s) => s.isMe) + 1;

    return {
      rankProbability: myRank <= input.targetRank ? 100 : 0,
      expectedRank: myRank,
      bestRank: myRank,
      worstRank: myRank,
      rankDistribution: { [String(myRank)]: iterations },
      myFinalScoreDistribution: {
        p10: input.myCurrentScore,
        p50: input.myCurrentScore,
        p90: input.myCurrentScore,
        mean: input.myCurrentScore,
      },
    };
  }

  let achievedCount = 0;
  let totalRank = 0;
  let bestRank = Infinity;
  let worstRank = 0;
  const distribution: Record<string, number> = {};
  const myFinalScores: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const myAddition = Math.max(
      0,
      normalRandom(input.myPaceMean, input.myPaceStdDev) * input.remainingHours
    );
    const myFinalScore = input.myCurrentScore + myAddition;
    myFinalScores.push(myFinalScore);

    const finalScores = [
      { score: myFinalScore, isMe: true },
      ...input.rivals.map((rival) => ({
        score:
          rival.currentScore +
          Math.max(0, normalRandom(rival.paceMean, rival.paceStdDev) * input.remainingHours),
        isMe: false,
      })),
    ];
    finalScores.sort((a, b) => b.score - a.score);
    const myRank = finalScores.findIndex((s) => s.isMe) + 1;

    if (myRank <= input.targetRank) achievedCount++;
    totalRank += myRank;
    bestRank = Math.min(bestRank, myRank);
    worstRank = Math.max(worstRank, myRank);
    const key = String(myRank);
    distribution[key] = (distribution[key] ?? 0) + 1;
  }

  myFinalScores.sort((a, b) => a - b);
  const p10 = myFinalScores[Math.floor(iterations * 0.1)];
  const p50 = myFinalScores[Math.floor(iterations * 0.5)];
  const p90 = myFinalScores[Math.floor(iterations * 0.9)];
  const mean = myFinalScores.reduce((a, b) => a + b, 0) / iterations;

  return {
    rankProbability: (achievedCount / iterations) * 100,
    expectedRank: totalRank / iterations,
    bestRank: bestRank === Infinity ? 1 : bestRank,
    worstRank,
    rankDistribution: distribution,
    myFinalScoreDistribution: { p10, p50, p90, mean },
  };
}

/**
 * ペース履歴から時速の平均・標準偏差を推定する
 * @param lookbackMinutes - 直近何分を対象にするか（デフォルト 60 分）
 */
export function estimatePaceParameters(
  history: Array<{ timestamp: Date; score: number }>,
  lookbackMinutes = 60
): { mean: number; stdDev: number } {
  if (history.length < 3) {
    return { mean: 0, stdDev: 100 };
  }

  const now = history[history.length - 1].timestamp;
  const cutoff = new Date(now.getTime() - lookbackMinutes * 60 * 1000);
  const recent = history.filter((h) => h.timestamp >= cutoff);

  if (recent.length < 3) {
    return { mean: 0, stdDev: 100 };
  }

  const paces: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const dt = recent[i].timestamp.getTime() - recent[i - 1].timestamp.getTime();
    const ds = recent[i].score - recent[i - 1].score;
    if (dt > 0 && ds >= 0) {
      paces.push((ds / dt) * 3_600_000); // ms → 時速
    }
  }

  if (paces.length === 0) return { mean: 0, stdDev: 100 };

  const mean = paces.reduce((a, b) => a + b, 0) / paces.length;
  const variance = paces.reduce((acc, p) => acc + (p - mean) ** 2, 0) / paces.length;
  const stdDev = Math.max(Math.sqrt(variance), mean * 0.1);

  return { mean, stdDev };
}
