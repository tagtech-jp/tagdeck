"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { StreamActivityItem } from "@/app/api/stream-activity/route";

type StreamActivityState = {
  items: StreamActivityItem[];
  loading: boolean;
};

/** 配信中の実イベント（コメント/ギフト）フィード。現状 Kick のみ本文が入る（他PFは空配列）。 */
export function useStreamActivity(): StreamActivityState {
  const [items, setItems] = useState<StreamActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [streamerProfileId, setStreamerProfileId] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/stream-activity");
      if (!res.ok) return;
      const data = (await res.json()) as {
        streamerProfileId: string | null;
        items: StreamActivityItem[];
      };
      setItems(data.items);
      setStreamerProfileId(data.streamerProfileId);
    } catch {
      // 取得失敗時は直前の表示を維持
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    if (!streamerProfileId) return;

    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let mounted = true;

    channel = supabase
      .channel(`stream-activity-${streamerProfileId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "events",
          filter: `streamer_id=eq.${streamerProfileId}`,
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
  }, [refetch, streamerProfileId]);

  return { items, loading };
}
