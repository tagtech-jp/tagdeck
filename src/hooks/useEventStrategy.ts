"use client";

import { useMemo } from "react";
import type { EventSimulatorRow } from "./useEventSimulator";
import type { EventTypeTemplate } from "@/lib/events/event-templates";
import { estimatePaceParameters } from "@/lib/events/monte-carlo";
import {
  rankItemsByEfficiency,
  computeReverseTarget,
  composeItemPlan,
  type ItemMasterEntry,
  type ReverseTargetResult,
  type ItemPlan,
} from "@/lib/events/strategy";

export interface EventStrategyResult {
  reverseTarget: ReverseTargetResult;
  itemPlan: ItemPlan[];
}

/**
 * イベント攻略（R2効率/R3逆算/R8順位↔スコア）のクライアント計算フック。
 * calculateExtendedForecastと同様、新規ルート無しで全て純関数をクライアント実行する。
 */
export function useEventStrategy(
  event: EventSimulatorRow | null,
  items: ItemMasterEntry[],
  template: EventTypeTemplate
): EventStrategyResult | null {
  return useMemo(() => {
    if (!event) return null;

    const isRankingType =
      event.eventType === "ranking" || event.eventType === "nice" || event.eventType === "viewer";

    const reverseTarget: ReverseTargetResult = isRankingType
      ? computeRankingReverseTarget(event)
      : computeReverseTarget({
          kind: "score",
          targetScore: event.targetScore ?? 0,
          currentScore: event.manualScore ?? event.currentScore,
        });

    const ranked = rankItemsByEfficiency(items, template);
    const itemPlan =
      reverseTarget.kind === "estimate"
        ? composeItemPlan(reverseTarget.requiredAdditionalPt, ranked)
        : [];

    return { reverseTarget, itemPlan };
  }, [event, items, template]);
}

function computeRankingReverseTarget(event: EventSimulatorRow): ReverseTargetResult {
  const paceHistory = event.paceHistory.map((p) => ({
    timestamp: new Date(p.timestamp),
    score: p.score,
  }));
  const { mean, stdDev } = estimatePaceParameters(paceHistory);
  const rivals = (event.rivalsSnapshot?.rivals ?? []).map((r) => ({
    name: r.name,
    currentScore: r.score,
    paceMean: mean,
    paceStdDev: stdDev,
  }));
  const remainingHours = Math.max(0, (new Date(event.endTime).getTime() - Date.now()) / 3_600_000);

  return computeReverseTarget({
    kind: "ranking",
    targetRank: event.targetRank ?? 1,
    currentScore: event.currentScore,
    paceMean: mean,
    paceStdDev: stdDev,
    paceHistoryLength: event.paceHistory.length,
    rivals,
    remainingHours,
    // currentRank===null は「名前不一致 or 未同期」のどちらも含む保守的な判定
    // (myEntry未特定なら不正確な逆算を出さないための安全側の扱い)。
    myEntryFound: event.currentRank !== null,
  });
}

export type { ItemMasterEntry };
