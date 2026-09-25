"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { calculateExtendedForecast, type ExtendedEventForecast, type EventType } from "@/lib/events/calculator";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type EventSimulatorRow = {
  id: string;
  userId: string;
  name: string;
  platform: string;
  eventType: string;
  targetScore: number | null;
  targetRank: number | null;
  eventRankingUrl: string | null;
  myEntryName: string | null;
  whowatchEventId: number | null;
  rankingType: string | null;
  startTime: string;
  endTime: string;
  status: string;
  currentScore: number;
  currentRank: number | null;
  manualScore: number | null;
  paceHistory: Array<{ timestamp: string; score: number }>;
  rivalsSnapshot: {
    timestamp: string;
    rivals: Array<{ rank: number; name: string; score: number }>;
  } | null;
  manualRivals: Array<{ name: string; score: number; targetScore?: number }>;
  lastSimulation: {
    timestamp: string;
    rankProbability: number;
    expectedRank: number;
    rankDistribution: Record<string, number>;
  } | null;
  createdAt: string;
  updatedAt: string;
};

export type EventSimulatorState = {
  events: EventSimulatorRow[];
  loading: boolean;
};

/** アクティブなシミュレーター一覧と Realtime 購読 */
export function useEventSimulatorList() {
  const [state, setState] = useState<EventSimulatorState>({ events: [], loading: true });

  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let mounted = true;

    const setup = async () => {
      const res = await fetch("/api/events");
      if (!mounted) return;
      if (res.ok) {
        const data = await res.json() as { events: EventSimulatorRow[] };
        setState({ events: data.events, loading: false });
      } else {
        setState((s) => ({ ...s, loading: false }));
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !mounted) return;

      channel = supabase
        .channel(`event-simulators-${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "event_simulators",
            filter: `user_id=eq.${user.id}`,
          },
          async () => {
            if (!mounted) return;
            const r = await fetch("/api/events");
            if (!mounted || !r.ok) return;
            const d = await r.json() as { events: EventSimulatorRow[] };
            setState({ events: d.events, loading: false });
          }
        )
        .subscribe();
    };

    setup();

    return () => {
      mounted = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  const createEvent = useCallback(async (body: object) => {
    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res;
  }, []);

  return { ...state, createEvent };
}

/** 単一イベントのモンテカルロ計算フック（5 秒ごとに再計算） */
export function useEventForecast(event: EventSimulatorRow | null) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 5000);
    return () => clearInterval(id);
  }, []);

  const forecast = useMemo<ExtendedEventForecast | null>(() => {
    if (!event) return null;

    const paceHistory = event.paceHistory.map((p) => ({
      timestamp: new Date(p.timestamp),
      score: p.score,
    }));

    // 自動取得ライバル + 手動入力ライバルを合成
    const autoRivals = (event.rivalsSnapshot?.rivals ?? []).map((r) => ({
      rank: r.rank,
      name: r.name,
      score: r.score,
    }));
    const manualRivals = (event.manualRivals ?? []).map((r, i) => ({
      rank: 9000 + i, // 仮順位
      name: r.name,
      score: r.score,
    }));
    const allRivals = [...autoRivals, ...manualRivals];

    return calculateExtendedForecast(
      {
        eventType: event.eventType as EventType,
        targetScore: event.targetScore ?? undefined,
        targetRank: event.targetRank ?? undefined,
        rivals: allRivals.length > 0 ? allRivals : undefined,
        currentScore: event.currentScore,
        startTime: new Date(event.startTime),
        endTime: new Date(event.endTime),
        paceHistory,
      },
      now
    );
  }, [event, now]);

  return { forecast, now };
}
