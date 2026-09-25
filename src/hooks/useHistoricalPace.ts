"use client";

import { useQuery } from "@tanstack/react-query";

export interface HistoricalPaceData {
  historicalMean: number;
  historicalStd: number;
  sampleCount: number;
  hasSufficientData: boolean;
}

const FALLBACK: HistoricalPaceData = {
  historicalMean: 0,
  historicalStd: 0,
  sampleCount: 0,
  hasSufficientData: false,
};

/** 過去イベント履歴からベイズ事前分布パラメータを取得する。
 *  5分間キャッシュ。sampleCount=0 のとき Phase 5a と同一動作（フォールバック）。
 */
export function useHistoricalPace(
  eventId: string,
  eventType: string
): { data: HistoricalPaceData; isLoading: boolean } {
  const validType =
    eventType === "score" ||
    eventType === "ranking" ||
    eventType === "nice" ||
    eventType === "viewer";

  const { data, isLoading } = useQuery<HistoricalPaceData>({
    queryKey: ["historical-pace", eventId, eventType],
    queryFn: async () => {
      const res = await fetch(
        `/api/events/${eventId}/historical-pace?eventType=${eventType}`
      );
      if (!res.ok) return FALLBACK;
      return (await res.json()) as HistoricalPaceData;
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!eventId && validType,
  });

  return { data: data ?? FALLBACK, isLoading };
}
