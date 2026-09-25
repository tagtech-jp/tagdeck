"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** /api/events/[id]/snapshots の 1 行（ranking_snapshots） */
export interface RankingSnapshotRow {
  id: string;
  rankingType?: string;
  capturedAt: string;
  status: number | null;
  myRank: number | null;
  myPoint: number | null;
  entries: Array<{ rank: number; point: number; user_id: string | null; user_path: string | null; name: string; total_view_count?: number | null }>;
}

const RELOAD_INTERVAL_MS = 5 * 60 * 1000;
/** これより古い（または無い）スナップショットしか無ければ、画面側から取得をかける */
export const STALE_AFTER_MS = 6 * 60 * 1000;
/** 画面側からの自動取得は最短でもこの間隔をあける（cron が生きていれば通常は発火しない） */
const AUTO_REFRESH_MIN_INTERVAL_MS = 5 * 60 * 1000;

export interface RankingSnapshotsState {
  /** null = 読み込み中 */
  snapshots: RankingSnapshotRow[] | null;
  /** 最新スナップショット（時刻順の末尾） */
  latest: RankingSnapshotRow | null;
  /** 画面側からの取得（POST refresh-ranking）中 */
  refreshing: boolean;
  refreshMessage: string | null;
  /** 手動取得。成功後にスナップショット一覧を再読込する */
  refresh: () => Promise<void>;
  reload: () => Promise<void>;
}

/**
 * ranking_snapshots の取得・5 分毎の再読込・自動取得をまとめたフック。
 * - cron（Workers Cron Trigger / 旧 GitHub Actions）が止まっていてもイベント画面を開いている間はデータが更新されるよう、
 *   最新スナップショットが無い/古いときは POST /api/events/[id]/refresh-ranking を画面側から呼ぶ（autoRefresh=true のとき）
 * - サーバ側は直近 45 秒以内に取得済みなら再取得しないため、複数タブで開いても API を叩きすぎない
 */
export function useRankingSnapshots(eventId: string, opts: { enabled: boolean; autoRefresh: boolean; limit?: number }): RankingSnapshotsState {
  const { enabled, autoRefresh, limit = 96 } = opts;
  const [snapshots, setSnapshots] = useState<RankingSnapshotRow[] | null>(enabled ? null : []);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const lastAutoRefreshAt = useRef(0);
  const inFlight = useRef(false);

  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      const r = await fetch(`/api/events/${eventId}/snapshots?limit=${limit}`);
      const d = r.ok ? ((await r.json()) as { snapshots?: RankingSnapshotRow[] }) : { snapshots: [] };
      setSnapshots(d.snapshots ?? []);
    } catch {
      setSnapshots((prev) => prev ?? []);
    }
  }, [eventId, enabled, limit]);

  const refresh = useCallback(async () => {
    if (!enabled || inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    setRefreshMessage(null);
    try {
      const res = await fetch(`/api/events/${eventId}/refresh-ranking`, { method: "POST" });
      const d = (await res.json().catch(() => null)) as { success?: boolean; message?: string; source?: string; throttled?: boolean } | null;
      if (!d?.success) setRefreshMessage(d?.message ?? "ランキングを取得できませんでした");
      else if (d.throttled) setRefreshMessage("直前に取得済みです（1 分以内）");
      else setRefreshMessage(d.source === "api" ? "公開 API から取得しました" : "取得しました");
      await reload();
    } catch {
      setRefreshMessage("ネットワークエラー");
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, [eventId, enabled, reload]);

  // 初回読込 + 5 分毎の再読込
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const run = () => {
      if (!cancelled) void reload();
    };
    run();
    const id = setInterval(run, RELOAD_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, reload]);

  // 古い/無い → 画面側から取得（cron 停止時の保険）
  const latest = snapshots && snapshots.length > 0
    ? snapshots.reduce((a, b) => (new Date(a.capturedAt).getTime() >= new Date(b.capturedAt).getTime() ? a : b))
    : null;
  const latestAt = latest ? new Date(latest.capturedAt).getTime() : 0;
  useEffect(() => {
    if (!enabled || !autoRefresh || snapshots === null) return;
    const now = Date.now();
    if (now - latestAt < STALE_AFTER_MS) return;
    if (now - lastAutoRefreshAt.current < AUTO_REFRESH_MIN_INTERVAL_MS) return;
    lastAutoRefreshAt.current = now;
    void refresh();
  }, [enabled, autoRefresh, snapshots, latestAt, refresh]);

  return { snapshots, latest, refreshing, refreshMessage, refresh, reload };
}
