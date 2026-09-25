"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type WhowatchMonitorState = {
  isConnected: boolean;
  isMonitoring: boolean;
  isLive: boolean;
  viewerCount: number;
  currentPoints: number;
  peakViewerCount: number;
  liveId: string | null;
  liveUrl: string | null;
  loading: boolean;
  errorMessage: string | null;
  // 集計値のみ・DB非永続化のため監視開始直後の5秒ポーリングが来るまでは0（要確認: 許容方針）。
  // comment_count/item_countは実機再検証の結果、信頼性未確認のためstateに含めない（(要確認)）。
  totalViewCount: number;
  niceCount: number;
};

type ProfileResponse = {
  whowatchUserId: string | null;
  whowatchIsMonitoring: boolean;
  whowatchViewerCount: number;
  whowatchCurrentPoints: number;
  whowatchPeakViewerCount: number;
  whowatchLiveId: string | null;
  whowatchLiveUrl: string | null;
};

type ProfileRow = {
  whowatch_user_id: string | null;
  whowatch_is_monitoring: boolean;
  whowatch_viewer_count: number;
  whowatch_current_points: number;
  whowatch_peak_viewer_count: number;
  whowatch_live_id: string | null;
};

const DEFAULT_STATE: WhowatchMonitorState = {
  isConnected: false,
  isMonitoring: false,
  isLive: false,
  viewerCount: 0,
  currentPoints: 0,
  peakViewerCount: 0,
  liveId: null,
  liveUrl: null,
  loading: true,
  errorMessage: null,
  totalViewCount: 0,
  niceCount: 0,
};

function liveIdToUrl(liveId: string | null): string | null {
  if (!liveId) return null;
  return `https://whowatch.tv/${encodeURIComponent(liveId)}`;
}

// 累計視聴数/いいね数はDB非永続化のため、プロフィール初期取得・Realtime更新経路には
// 含まれない（poll経路でのみ取得できる集計値）。ここでは既存値を保つため呼び出し側でマージする。
type EngagementCounts = Pick<WhowatchMonitorState, "totalViewCount" | "niceCount">;

function apiResponseToState(
  p: ProfileResponse
): Omit<WhowatchMonitorState, "loading" | "errorMessage" | keyof EngagementCounts> {
  return {
    isConnected: Boolean(p.whowatchUserId),
    isMonitoring: p.whowatchIsMonitoring,
    isLive: Boolean(p.whowatchLiveId),
    viewerCount: p.whowatchViewerCount,
    currentPoints: p.whowatchCurrentPoints,
    peakViewerCount: p.whowatchPeakViewerCount,
    liveId: p.whowatchLiveId,
    liveUrl: p.whowatchLiveUrl ?? liveIdToUrl(p.whowatchLiveId),
  };
}

function rowToState(
  row: ProfileRow
): Omit<WhowatchMonitorState, "loading" | "errorMessage" | keyof EngagementCounts> {
  return {
    isConnected: Boolean(row.whowatch_user_id),
    isMonitoring: Boolean(row.whowatch_is_monitoring),
    isLive: Boolean(row.whowatch_live_id),
    viewerCount: Number(row.whowatch_viewer_count) || 0,
    currentPoints: Number(row.whowatch_current_points) || 0,
    peakViewerCount: Number(row.whowatch_peak_viewer_count) || 0,
    liveId: row.whowatch_live_id ?? null,
    liveUrl: liveIdToUrl(row.whowatch_live_id ?? null),
  };
}

export function useWhowatchMonitor() {
  const [state, setState] = useState<WhowatchMonitorState>(DEFAULT_STATE);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let mounted = true;

    const setup = async () => {
      // 初期状態：Route Handler 経由（DATABASE_URL で RLS 不要）
      const res = await fetch("/api/platforms/whowatch/profile");
      if (!mounted) return;
      if (res.ok) {
        const data = (await res.json()) as ProfileResponse;
        setState({ ...DEFAULT_STATE, ...apiResponseToState(data), loading: false, errorMessage: null });
      } else {
        setState((s) => ({ ...s, loading: false }));
      }

      // ユーザー ID を取得してチャンネル名をユニーク化
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !mounted) return;

      // channel → on → subscribe を必ずチェーンで一気に呼ぶ
      channel = supabase
        .channel(`whowatch-monitor-${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "streamer_profiles",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            if (!mounted) return;
            // totalViewCount/niceCount はDB非永続化のため既存値を保持（フルリプレイスしない）
            setState((s) => ({
              ...s,
              ...rowToState(payload.new as ProfileRow),
              loading: false,
              errorMessage: null,
            }));
          }
        )
        .subscribe();
    };

    setup();

    return () => {
      mounted = false;
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, []);

  // タブ可視化時に isMonitoring を再取得（Supabase Realtime のフォールバック）
  useEffect(() => {
    let mounted = true;
    const refetch = async () => {
      try {
        const res = await fetch("/api/platforms/whowatch/profile");
        if (!res.ok || !mounted) return;
        const data = (await res.json()) as ProfileResponse;
        setState((s) => ({
          ...s,
          ...apiResponseToState(data),
          loading: false,
          errorMessage: null,
        }));
      } catch {
        // タブ可視化時の保険なので致命的でない
      }
    };
    const handler = () => {
      if (document.visibilityState === "visible") refetch();
    };
    document.addEventListener("visibilitychange", handler);
    return () => {
      mounted = false;
      document.removeEventListener("visibilitychange", handler);
    };
  }, []);

  // 5 秒ポーリング（監視中のみ）
  useEffect(() => {
    let mounted = true;
    if (state.isMonitoring) {
      const poll = async () => {
        try {
          const res = await fetch("/api/platforms/whowatch/poll", { method: "POST" });
          if (!mounted) return;
          if (!res.ok) {
            const data = await res.json().catch(() => null) as { error?: string } | null;
            setState((s) => ({
              ...s,
              errorMessage: data?.error ?? "ふわっち監視の更新に失敗しました",
            }));
            return;
          }
          const data = await res.json() as {
            isLive: boolean; liveId: string | null;
            liveUrl: string | null;
            viewerCount: number; currentPoints: number; peakViewerCount: number;
            totalViewCount: number; niceCount: number;
          };
          setState((s) => ({
            ...s,
            isLive: data.isLive,
            liveId: data.liveId,
            liveUrl: data.liveUrl ?? liveIdToUrl(data.liveId),
            viewerCount: data.viewerCount,
            currentPoints: data.currentPoints,
            peakViewerCount: data.peakViewerCount,
            totalViewCount: data.totalViewCount,
            niceCount: data.niceCount,
            errorMessage: null,
          }));
        } catch {
          if (mounted) {
            setState((s) => ({
              ...s,
              errorMessage: "ふわっち監視の通信に失敗しました",
            }));
          }
        }
      };
      poll();
      intervalRef.current = setInterval(poll, 5000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      mounted = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [state.isMonitoring]);

  const toggleMonitoring = useCallback(async () => {
    const action = state.isMonitoring ? "stop" : "start";
    const res = await fetch("/api/platforms/whowatch/monitor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await res.json().catch(() => null) as { isMonitoring?: boolean; error?: string } | null;
    if (!res.ok) {
      const message = data?.error ?? "ふわっち監視の切り替えに失敗しました";
      setState((s) => ({ ...s, errorMessage: message }));
      throw new Error(message);
    }
    setState((s) => ({
      ...s,
      isMonitoring: Boolean(data?.isMonitoring),
      errorMessage: null,
    }));
  }, [state.isMonitoring]);

  return { ...state, toggleMonitoring };
}
