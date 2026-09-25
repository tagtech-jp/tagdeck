"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

type MonitorStatus = "idle" | "monitoring" | "live" | "offline" | "error";

interface NiconicoState {
  userId: string | null;
  isMonitoring: boolean;
  status: MonitorStatus;
  isLive: boolean;
  title: string | null;
  viewerCount: number;
  commentCount: number;
}

const POLL_INTERVAL = 5000;

type NiconicoProfileResponse = {
  niconicoUserId?: string | null;
  niconicoIsLive?: boolean;
  niconicoTitle?: string | null;
  niconicoViewerCount?: number;
  niconicoCommentCount?: number;
  niconicoIsMonitoring?: boolean;
};

function profileToState(data: NiconicoProfileResponse): Partial<NiconicoState> {
  const isMonitoring = data.niconicoIsMonitoring ?? false;
  const isLive = data.niconicoIsLive ?? false;

  return {
    userId: data.niconicoUserId ?? null,
    isLive,
    title: data.niconicoTitle ?? null,
    viewerCount: data.niconicoViewerCount ?? 0,
    commentCount: data.niconicoCommentCount ?? 0,
    isMonitoring,
    status: !isMonitoring ? "idle" : isLive ? "live" : "offline",
  };
}

export function useNiconicoMonitor() {
  const [state, setState] = useState<NiconicoState>({
    userId: null,
    isMonitoring: false,
    status: "idle",
    isLive: false,
    title: null,
    viewerCount: 0,
    commentCount: 0,
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Load initial profile state
  useEffect(() => {
    fetch("/api/platforms/niconico/profile")
      .then((r) => r.json())
      .then((data) => {
        if (!mountedRef.current) return;
        setState((prev) => ({ ...prev, ...profileToState(data) }));
      })
      .catch(() => {});
  }, []);

  // Supabase Realtime: watch streamer_profiles for this user
  useEffect(() => {
    let channel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;

    const setupRealtime = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || !mountedRef.current) return;

      channel = supabase
        .channel(`niconico-monitor-${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "streamer_profiles",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            if (!mountedRef.current) return;
            const row = payload.new as Record<string, unknown>;
            const isMonitoring = Boolean(row.niconico_is_monitoring);
            const isLive = Boolean(row.niconico_is_live);
            setState((prev) => ({
              ...prev,
              isMonitoring,
              isLive,
              title: (row.niconico_title as string | null) ?? null,
              viewerCount: Number(row.niconico_viewer_count ?? 0),
              commentCount: Number(row.niconico_comment_count ?? 0),
              status: !isMonitoring ? "idle" : isLive ? "live" : "offline",
            }));
          },
        )
        .subscribe();
    };

    setupRealtime();

    return () => {
      if (channel) {
        createClient().removeChannel(channel);
      }
    };
  }, []);

  // タブ可視化時に isMonitoring を再取得（Supabase Realtime のフォールバック）
  useEffect(() => {
    const refetch = async () => {
      try {
        const res = await fetch("/api/platforms/niconico/profile");
        if (!res.ok || !mountedRef.current) return;
        const data = await res.json();
        setState((prev) => ({ ...prev, ...profileToState(data) }));
      } catch {
        // タブ可視化時の保険なので致命的でない
      }
    };
    const handler = () => {
      if (document.visibilityState === "visible") refetch();
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/platforms/niconico/poll", { method: "POST" });
      if (!mountedRef.current) return;
      const data = await res.json();

      if (data.status === "not_monitoring") {
        stopPolling();
        setState((prev) => ({ ...prev, status: "idle", isMonitoring: false }));
        return;
      }
      if (data.status === "live") {
        setState((prev) => ({
          ...prev,
          status: "live",
          isLive: true,
          title: data.title ?? prev.title,
          viewerCount: data.viewerCount ?? prev.viewerCount,
          commentCount: data.commentCount ?? prev.commentCount,
        }));
      } else if (data.status === "offline" || data.status === "scheduled") {
        setState((prev) => ({ ...prev, status: "offline", isLive: false }));
      }
    } catch {
      if (mountedRef.current) {
        setState((prev) => ({ ...prev, status: "error" }));
      }
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL);
  }, [poll, stopPolling]);

  // Start/stop polling based on isMonitoring
  useEffect(() => {
    if (state.isMonitoring) {
      startPolling();
    } else {
      stopPolling();
    }
    return stopPolling;
  }, [state.isMonitoring, startPolling, stopPolling]);

  const startMonitoring = useCallback(async () => {
    const res = await fetch("/api/platforms/niconico/monitor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "監視開始に失敗しました");
    setState((prev) => ({ ...prev, isMonitoring: true, status: "monitoring" }));
  }, []);

  const stopMonitoring = useCallback(async () => {
    const res = await fetch("/api/platforms/niconico/monitor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "監視停止に失敗しました");
    setState((prev) => ({
      ...prev,
      isMonitoring: false,
      status: "idle",
      isLive: false,
    }));
  }, []);

  return { state, startMonitoring, stopMonitoring };
}
