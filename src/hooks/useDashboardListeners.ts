"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Listener } from "@/types/listener";

type SerializedListener = Omit<Listener, "lastSeenAt" | "firstSeenAt"> & {
  lastSeenAt: string;
  firstSeenAt: string;
};

type ListenersResponse = {
  streamerProfileId: string | null;
  listeners: SerializedListener[];
};

type DashboardListenersState = {
  listeners: Listener[];
  streamerProfileId: string | null;
  loading: boolean;
  errorMessage: string | null;
};

function deserializeListener(listener: SerializedListener): Listener {
  return {
    ...listener,
    lastSeenAt: new Date(listener.lastSeenAt),
    firstSeenAt: new Date(listener.firstSeenAt),
  };
}

export function useDashboardListeners(): DashboardListenersState {
  const [state, setState] = useState<DashboardListenersState>({
    listeners: [],
    streamerProfileId: null,
    loading: true,
    errorMessage: null,
  });

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/listeners");
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setState((prev) => ({
          ...prev,
          loading: false,
          errorMessage: data?.error ?? "CRM の取得に失敗しました",
        }));
        return;
      }

      const data = (await res.json()) as ListenersResponse;
      setState({
        listeners: data.listeners.map(deserializeListener),
        streamerProfileId: data.streamerProfileId,
        loading: false,
        errorMessage: null,
      });
    } catch {
      setState((prev) => ({
        ...prev,
        loading: false,
        errorMessage: "CRM の通信に失敗しました",
      }));
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    if (!state.streamerProfileId) return;

    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let mounted = true;

    channel = supabase
      .channel(`dashboard-listeners-${state.streamerProfileId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "listeners",
          filter: `streamer_id=eq.${state.streamerProfileId}`,
        },
        () => {
          if (mounted) refetch();
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [refetch, state.streamerProfileId]);

  return state;
}
