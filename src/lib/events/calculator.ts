/**
 * イベント勝率計算ロジック（拡張版）
 * イベントタイプ別（score / ranking / nice / viewer）に分岐する。
 */

import { simulateRankingProbability, estimatePaceParameters, type RivalState } from "./monte-carlo";

export type EventType = "score" | "ranking" | "nice" | "viewer";

export interface ExtendedEventState {
  eventType: EventType;
  targetScore?: number;
  targetRank?: number;
  rivals?: Array<{ rank: number; name: string; score: number }>;
  currentScore: number;
  startTime: Date;
  endTime: Date;
  paceHistory: Array<{ timestamp: Date; score: number }>;
}

export interface ExtendedEventForecast {
  eventType: EventType;
  remainingMinutes: number;
  elapsedMinutes: number;
  progressPercent: number;
  currentHourlyPace: number;
  paceStdDev: number;
  message: string;
  // score 型
  remainingScore?: number;
  requiredHourlyPace?: number;
  // ranking / nice / viewer 型
  rankProbability?: number;
  expectedRank?: number;
  rankDistribution?: Record<string, number>;
  myFinalScorePercentiles?: { p10: number; p50: number; p90: number };
  status: "ahead" | "on_track" | "at_risk" | "impossible" | "completed";
}

export function calculateExtendedForecast(
  state: ExtendedEventState,
  now: Date = new Date()
): ExtendedEventForecast {
  const remainingMs = Math.max(0, state.endTime.getTime() - now.getTime());
  const elapsedMs = Math.max(0, now.getTime() - state.startTime.getTime());
  const remainingMinutes = remainingMs / 60_000;
  const elapsedMinutes = elapsedMs / 60_000;

  const { mean: paceMean, stdDev: paceStdDev } = estimatePaceParameters(state.paceHistory);

  if (state.eventType === "score") {
    return calcScoreForecast(state, paceMean, paceStdDev, remainingMinutes, elapsedMinutes);
  }
  return calcRankingForecast(state, paceMean, paceStdDev, remainingMinutes, elapsedMinutes);
}

function calcScoreForecast(
  state: ExtendedEventState,
  paceMean: number,
  paceStdDev: number,
  remainingMinutes: number,
  elapsedMinutes: number
): ExtendedEventForecast {
  const targetScore = state.targetScore ?? 0;
  const remainingScore = Math.max(0, targetScore - state.currentScore);
  const progressPercent = targetScore > 0
    ? Math.min(100, (state.currentScore / targetScore) * 100)
    : 0;

  if (state.currentScore >= targetScore) {
    return {
      eventType: "score",
      remainingMinutes,
      elapsedMinutes,
      progressPercent: 100,
      currentHourlyPace: paceMean,
      paceStdDev,
      remainingScore: 0,
      requiredHourlyPace: 0,
      status: "completed",
      message: "目標達成！",
    };
  }

  if (remainingMinutes <= 0) {
    return {
      eventType: "score",
      remainingMinutes: 0,
      elapsedMinutes,
      progressPercent,
      currentHourlyPace: 0,
      paceStdDev,
      remainingScore,
      requiredHourlyPace: Infinity,
      status: "impossible",
      message: "イベント終了",
    };
  }

  const requiredHourlyPace = (remainingScore / remainingMinutes) * 60;
  const paceRatio = requiredHourlyPace > 0 ? paceMean / requiredHourlyPace : 0;

  let status: ExtendedEventForecast["status"];
  let message: string;

  if (paceRatio >= 1.1) {
    status = "ahead";
    message = `余裕で達成ペース（必要ペースの ${Math.round(paceRatio * 100)}%）`;
  } else if (paceRatio >= 1.0) {
    status = "on_track";
    message = "順調なペースです";
  } else if (paceRatio >= 0.7) {
    status = "at_risk";
    message = `ペースアップが必要（必要ペースの ${Math.round(paceRatio * 100)}%）`;
  } else {
    status = "impossible";
    message = `ペースが大きく不足（必要ペースの ${Math.round(paceRatio * 100)}%）`;
  }

  return {
    eventType: "score",
    remainingMinutes,
    elapsedMinutes,
    progressPercent,
    currentHourlyPace: paceMean,
    paceStdDev,
    remainingScore,
    requiredHourlyPace,
    status,
    message,
  };
}

function calcRankingForecast(
  state: ExtendedEventState,
  paceMean: number,
  paceStdDev: number,
  remainingMinutes: number,
  elapsedMinutes: number
): ExtendedEventForecast {
  const targetRank = state.targetRank ?? 1;
  const rivals = state.rivals ?? [];
  const remainingHours = remainingMinutes / 60;

  // フェーズ 5b でライバル個別推定に置き換え予定。現在は自分と同ペース仮定。
  const rivalStates: RivalState[] = rivals.map((r) => ({
    name: r.name,
    currentScore: r.score,
    paceMean,
    paceStdDev,
  }));

  const simulation = simulateRankingProbability({
    myCurrentScore: state.currentScore,
    myPaceMean: paceMean,
    myPaceStdDev: paceStdDev,
    rivals: rivalStates,
    remainingHours,
    targetRank,
    iterations: 10000,
  });

  let status: ExtendedEventForecast["status"];
  let message: string;

  if (simulation.rankProbability >= 90) {
    status = "ahead";
    message = `目標 ${targetRank} 位以内ほぼ確実（${simulation.rankProbability.toFixed(1)}%）`;
  } else if (simulation.rankProbability >= 60) {
    status = "on_track";
    message = `目標 ${targetRank} 位以内達成有望（${simulation.rankProbability.toFixed(1)}%）`;
  } else if (simulation.rankProbability >= 25) {
    status = "at_risk";
    message = `目標 ${targetRank} 位以内は厳しい状況（${simulation.rankProbability.toFixed(1)}%）`;
  } else {
    status = "impossible";
    message = `目標 ${targetRank} 位以内は困難（${simulation.rankProbability.toFixed(1)}%）`;
  }

  return {
    eventType: state.eventType,
    remainingMinutes,
    elapsedMinutes,
    progressPercent: 0, // ランキング型は単純進捗率にならない
    currentHourlyPace: paceMean,
    paceStdDev,
    rankProbability: simulation.rankProbability,
    expectedRank: simulation.expectedRank,
    rankDistribution: simulation.rankDistribution,
    myFinalScorePercentiles: {
      p10: simulation.myFinalScoreDistribution.p10,
      p50: simulation.myFinalScoreDistribution.p50,
      p90: simulation.myFinalScoreDistribution.p90,
    },
    status,
    message,
  };
}
