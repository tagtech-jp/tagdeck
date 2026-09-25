"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  KICK_PUSHER_CONFIG,
  KICK_PUSHER_EVENTS,
  getKickChatChannelName,
  getKickChannelChannelName,
} from "@/lib/platforms/kick";
import type { RealtimeChannel } from "@supabase/supabase-js";

export interface KickMonitorState {
  isMonitoring: boolean;
  isLive: boolean;
  username: string | null;
  channelId: string | null;
  chatroomId: string | null;
  viewerCount: number;
  peakViewerCount: number;
  followerCount: number;
  lastEventAt: Date | null;
  status: "idle" | "connecting" | "online" | "offline" | "error";
  errorMessage?: string;
}

const DEFAULT_STATE: KickMonitorState = {
  isMonitoring: false,
  isLive: false,
  username: null,
  channelId: null,
  chatroomId: null,
  viewerCount: 0,
  peakViewerCount: 0,
  followerCount: 0,
  lastEventAt: null,
  status: "idle",
};

type KickProfileResponse = {
  kickUsername?: string | null;
  kickChannelId?: string | null;
  kickChatroomId?: string | null;
  kickIsLive?: boolean;
  kickViewerCount?: number;
  kickPeakViewerCount?: number;
  kickFollowerCount?: number;
  kickIsMonitoring?: boolean;
};

function profileToState(data: KickProfileResponse): Partial<KickMonitorState> {
  const isMonitoring = data.kickIsMonitoring ?? false;
  const viewerCount = data.kickViewerCount ?? 0;
  const isLive = (data.kickIsLive ?? false) || (isMonitoring && viewerCount > 0);

  return {
    username: data.kickUsername ?? null,
    channelId: data.kickChannelId ?? null,
    chatroomId: data.kickChatroomId ?? null,
    isLive,
    viewerCount,
    peakViewerCount: data.kickPeakViewerCount ?? 0,
    followerCount: data.kickFollowerCount ?? 0,
    isMonitoring,
    status: isMonitoring ? (isLive ? "online" : "offline") : "idle",
  };
}

export function useKickMonitor() {
  const [state, setState] = useState<KickMonitorState>(DEFAULT_STATE);
  const pusherRef = useRef<import("pusher-js").default | null>(null);

  // Supabase Realtime で profile 変更を購読
  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let mounted = true;

    const setup = async () => {
      // 初期状態を Route Handler 経由で取得（RLS 非依存）
      try {
        const res = await fetch("/api/platforms/kick/profile");
        if (res.ok && mounted) {
          const data = await res.json() as KickProfileResponse;
          setState((prev) => ({ ...prev, ...profileToState(data) }));
        }
      } catch {
        // ネットワークエラー時はデフォルト状態を維持
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || !mounted) return;

      channel = supabase
        .channel(`kick-monitor-${user.id}`)
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
            const r = payload.new as Record<string, unknown>;
            const isMonitoring = Boolean(r.kick_is_monitoring);
            const viewerCount = Number(r.kick_viewer_count) || 0;
            const isLive = Boolean(r.kick_is_live) || (isMonitoring && viewerCount > 0);
            setState((prev) => ({
              ...prev,
              isMonitoring,
              isLive,
              viewerCount,
              peakViewerCount: Number(r.kick_peak_viewer_count) || 0,
              followerCount: Number(r.kick_follower_count) || 0,
              lastEventAt: r.kick_last_event_at
                ? new Date(String(r.kick_last_event_at))
                : null,
              status: isMonitoring ? (isLive ? "online" : "offline") : "idle",
            }));
          },
        )
        .subscribe();
    };

    setup();

    return () => {
      mounted = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  // タブ可視化時に isMonitoring を再取得（Supabase Realtime のフォールバック）
  useEffect(() => {
    let mounted = true;
    const refetch = async () => {
      try {
        const res = await fetch("/api/platforms/kick/profile");
        if (!res.ok || !mounted) return;
        const data = await res.json() as KickProfileResponse;
        setState((prev) => ({ ...prev, ...profileToState(data) }));
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

  // 監視中のみ Pusher 接続を維持
  useEffect(() => {
    if (!state.isMonitoring || !state.chatroomId || !state.channelId) {
      if (pusherRef.current) {
        pusherRef.current.disconnect();
        pusherRef.current = null;
      }
      setState((prev) => ({
        ...prev,
        status: prev.isMonitoring ? prev.status : "idle",
      }));
      return;
    }

    let mounted = true;

    const setupPusher = async () => {
      setState((prev) => ({ ...prev, status: "connecting" }));

      const Pusher = (await import("pusher-js")).default;
      if (!mounted) return;

      const pusher = new Pusher(KICK_PUSHER_CONFIG.appKey, {
        cluster: KICK_PUSHER_CONFIG.cluster,
        forceTLS: true,
      });

      pusher.connection.bind("connected", () => {
        if (!mounted) return;
        setState((prev) => ({
          ...prev,
          status: prev.isLive ? "online" : "offline",
        }));
      });

      pusher.connection.bind("error", (err: unknown) => {
        if (!mounted) return;
        const msg = err instanceof Error ? err.message : "Pusher 接続エラー";
        setState((prev) => ({ ...prev, status: "error", errorMessage: msg }));
      });

      pusherRef.current = pusher;

      const chatroomId = state.chatroomId!;
      const channelId = state.channelId!;

      const chatCh = pusher.subscribe(getKickChatChannelName(chatroomId));
      chatCh.bind(KICK_PUSHER_EVENTS.CHAT_MESSAGE, (data: unknown) => {
        sendEventToServer("chat_message", data);
      });
      chatCh.bind(KICK_PUSHER_EVENTS.GIFTED_SUBSCRIPTIONS, (data: unknown) => {
        sendEventToServer("gift_subscription", data);
      });
      chatCh.bind(KICK_PUSHER_EVENTS.SUBSCRIPTION, (data: unknown) => {
        sendEventToServer("subscription", data);
      });

      const channelCh = pusher.subscribe(getKickChannelChannelName(channelId));
      channelCh.bind(KICK_PUSHER_EVENTS.STREAMER_IS_LIVE, (data: unknown) => {
        setState((prev) => ({ ...prev, isLive: true, status: "online" }));
        sendEventToServer("streamer_live", data);
      });
      channelCh.bind(KICK_PUSHER_EVENTS.STOP_STREAM, (data: unknown) => {
        setState((prev) => ({ ...prev, isLive: false, status: "offline" }));
        sendEventToServer("stop_stream", data);
      });
    };

    setupPusher();

    return () => {
      mounted = false;
      if (pusherRef.current) {
        pusherRef.current.disconnect();
        pusherRef.current = null;
      }
    };
  }, [state.isMonitoring, state.chatroomId, state.channelId]);

  const sendEventToServer = async (
    type:
      | "chat_message"
      | "gift_subscription"
      | "subscription"
      | "streamer_live"
      | "stop_stream",
    payload: unknown,
  ) => {
    try {
      await fetch("/api/platforms/kick/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, payload }),
      });
    } catch {
      // イベント送信失敗は無視（次のイベントで回復）
    }
  };

  const startMonitoring = async () => {
    const res = await fetch("/api/platforms/kick/monitor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error ?? "監視開始に失敗しました");
    }
    setState((prev) => ({ ...prev, isMonitoring: true }));
  };

  const stopMonitoring = async () => {
    const res = await fetch("/api/platforms/kick/monitor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
    });
    if (!res.ok) {
      throw new Error("監視停止に失敗しました");
    }
    setState((prev) => ({ ...prev, isMonitoring: false, status: "idle" }));
  };

  return { state, startMonitoring, stopMonitoring };
}
