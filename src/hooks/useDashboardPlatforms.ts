"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Platform } from "@/types/platform";

type PlatformSummary = {
  platform: Platform;
  label: string;
  accountLabel: string;
  accountValue: string | null;
  isConnected: boolean;
  isMonitoring: boolean;
  isLive: boolean;
  viewerCount: number | null;
  peakViewerCount: number | null;
  currentPoints: number | null;
  commentCount: number | null;
  followerCount: number | null;
  lastPolledAt: string | null;
  liveUrl: string | null;
};

type WhowatchProfile = {
  whowatchUserId: string | null;
  whowatchIsMonitoring: boolean;
  whowatchViewerCount: number;
  whowatchCurrentPoints: number;
  whowatchPeakViewerCount: number;
  whowatchLiveId: string | null;
  whowatchLiveUrl: string | null;
  whowatchLastPolledAt: string | null;
};

type KickProfile = {
  kickUsername: string | null;
  kickIsMonitoring: boolean;
  kickIsLive: boolean;
  kickViewerCount: number;
  kickPeakViewerCount: number;
  kickFollowerCount: number;
  kickLiveUrl: string | null;
};

type NiconicoProfile = {
  niconicoUserId: string | null;
  niconicoProgramId: string | null;
  niconicoIsMonitoring: boolean;
  niconicoIsLive: boolean;
  niconicoViewerCount: number;
  niconicoCommentCount: number;
  niconicoPeakViewerCount: number;
  niconicoLastPolledAt: string | null;
  niconicoLiveUrl: string | null;
};

type DashboardPlatformsState = {
  platforms: PlatformSummary[];
  loading: boolean;
  errorMessage: string | null;
};

const DEFAULT_PLATFORMS: PlatformSummary[] = [
  {
    platform: "whowatch",
    label: "ふわっち",
    accountLabel: "ユーザー ID",
    accountValue: null,
    isConnected: false,
    isMonitoring: false,
    isLive: false,
    viewerCount: null,
    peakViewerCount: null,
    currentPoints: null,
    commentCount: null,
    followerCount: null,
    lastPolledAt: null,
    liveUrl: null,
  },
  {
    platform: "kick",
    label: "Kick",
    accountLabel: "username",
    accountValue: null,
    isConnected: false,
    isMonitoring: false,
    isLive: false,
    viewerCount: null,
    peakViewerCount: null,
    currentPoints: null,
    commentCount: null,
    followerCount: null,
    lastPolledAt: null,
    liveUrl: null,
  },
  {
    platform: "niconico",
    label: "ニコ生",
    accountLabel: "ユーザー ID",
    accountValue: null,
    isConnected: false,
    isMonitoring: false,
    isLive: false,
    viewerCount: null,
    peakViewerCount: null,
    currentPoints: null,
    commentCount: null,
    followerCount: null,
    lastPolledAt: null,
    liveUrl: null,
  },
];

async function fetchProfile<T>(path: string): Promise<T | null> {
  const res = await fetch(path);
  if (!res.ok) return null;
  return (await res.json()) as T;
}

function buildPlatformSummaries(
  whowatch: WhowatchProfile | null,
  kick: KickProfile | null,
  niconico: NiconicoProfile | null,
): PlatformSummary[] {
  return [
    {
      ...DEFAULT_PLATFORMS[0],
      accountValue: whowatch?.whowatchUserId ?? null,
      isConnected: Boolean(whowatch?.whowatchUserId),
      isMonitoring: whowatch?.whowatchIsMonitoring ?? false,
      isLive: Boolean(whowatch?.whowatchLiveId),
      viewerCount: whowatch?.whowatchViewerCount ?? null,
      peakViewerCount: whowatch?.whowatchPeakViewerCount ?? null,
      currentPoints: whowatch?.whowatchCurrentPoints ?? null,
      lastPolledAt: whowatch?.whowatchLastPolledAt ?? null,
      liveUrl: whowatch?.whowatchLiveUrl ?? null,
    },
    {
      ...DEFAULT_PLATFORMS[1],
      accountValue: kick?.kickUsername ?? null,
      isConnected: Boolean(kick?.kickUsername),
      isMonitoring: kick?.kickIsMonitoring ?? false,
      isLive: Boolean(
        kick?.kickIsLive || ((kick?.kickIsMonitoring ?? false) && (kick?.kickViewerCount ?? 0) > 0),
      ),
      viewerCount: kick?.kickViewerCount ?? null,
      peakViewerCount: kick?.kickPeakViewerCount ?? null,
      followerCount: kick?.kickFollowerCount ?? null,
      lastPolledAt: null,
      liveUrl: kick?.kickLiveUrl ?? null,
    },
    {
      ...DEFAULT_PLATFORMS[2],
      accountValue: niconico?.niconicoUserId ?? null,
      isConnected: Boolean(niconico?.niconicoUserId),
      isMonitoring: niconico?.niconicoIsMonitoring ?? false,
      isLive: niconico?.niconicoIsLive ?? false,
      viewerCount: niconico?.niconicoViewerCount ?? null,
      peakViewerCount: niconico?.niconicoPeakViewerCount ?? null,
      commentCount: niconico?.niconicoCommentCount ?? null,
      lastPolledAt: niconico?.niconicoLastPolledAt ?? null,
      liveUrl: niconico?.niconicoLiveUrl ?? null,
    },
  ];
}

export function useDashboardPlatforms(): DashboardPlatformsState {
  const [state, setState] = useState<DashboardPlatformsState>({
    platforms: DEFAULT_PLATFORMS,
    loading: true,
    errorMessage: null,
  });

  const refetch = useCallback(async () => {
    try {
      const [whowatch, kick, niconico] = await Promise.all([
        fetchProfile<WhowatchProfile>("/api/platforms/whowatch/profile"),
        fetchProfile<KickProfile>("/api/platforms/kick/profile"),
        fetchProfile<NiconicoProfile>("/api/platforms/niconico/profile"),
      ]);

      setState({
        platforms: buildPlatformSummaries(whowatch, kick, niconico),
        loading: false,
        errorMessage: null,
      });
    } catch {
      setState((prev) => ({
        ...prev,
        loading: false,
        errorMessage: "配信ユーザー ID の取得に失敗しました",
      }));
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") refetch();
    };

    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [refetch]);

  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let mounted = true;

    const setup = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || !mounted) return;

      channel = supabase
        .channel(`dashboard-platforms-${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "streamer_profiles",
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            if (mounted) refetch();
          },
        )
        .subscribe();
    };

    setup();

    return () => {
      mounted = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [refetch]);

  return state;
}

export type { PlatformSummary };
