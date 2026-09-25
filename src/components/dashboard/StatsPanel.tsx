"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { ViewerCounter } from "@/components/stats/ViewerCounter";
import { EventTicker } from "@/components/stats/EventTicker";
import { DashboardPlatformStatus } from "@/components/dashboard/DashboardPlatformStatus";
import { PlatformScopeBadge } from "@/components/dashboard/PlatformScopeBadge";
import { useStreamActivity } from "@/hooks/useStreamActivity";
import type { WhowatchMonitorState } from "@/hooks/useWhowatchMonitor";
import type { PlatformSummary } from "@/hooks/useDashboardPlatforms";

type Props = {
  whowatch: WhowatchMonitorState;
  platforms: PlatformSummary[];
  platformsLoading: boolean;
  platformsError: string | null;
};

export function StatsPanel({ whowatch, platforms, platformsLoading, platformsError }: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  // 「直近のイベント」は実データのみ（現状Kickのみコメント/ギフト本文を取得できる）
  const { items: activityItems, loading: activityLoading } = useStreamActivity();

  const stats = {
    platform: "whowatch" as const,
    viewerCount: whowatch.viewerCount,
    peakViewerCount: whowatch.peakViewerCount,
  };

  // R9 初回セットアップ導線: 全プラットフォーム未連携なら連携画面への直行バナーを表示
  const allDisconnected =
    !platformsLoading && platforms.length > 0 && platforms.every((p) => !p.isConnected);

  return (
    <div className="space-y-3">
      {allDisconnected && (
        <Link
          href="/settings/platforms"
          className="block rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground"
        >
          まず配信プラットフォームを連携しましょう →
        </Link>
      )}
      {!whowatch.isMonitoring && (
        <div className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          監視を開始するとリアルタイムデータが表示されます
        </div>
      )}
      {whowatch.isMonitoring && !whowatch.isLive && (
        <div className="rounded-lg bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
          配信が検出されていません
        </div>
      )}
      {whowatch.errorMessage && (
        <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {whowatch.errorMessage}
        </div>
      )}

      {/* ヒーローカード: 視聴者数（常時実データ）＋ 集計バッジ（配信中のみ・集計値のみ。個別コメント本文/送信者は取得不可） */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm dark:shadow-none">
        <ViewerCounter stats={stats} />
        {whowatch.isLive && (
          <>
            <div className="mt-3 flex justify-end">
              <PlatformScopeBadge platforms={["whowatch"]} />
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg bg-muted px-2 py-2">
                <div className="text-xs text-muted-foreground">合計閲覧</div>
                <div className="text-lg font-semibold text-foreground">
                  {whowatch.totalViewCount.toLocaleString()}
                </div>
              </div>
              <div className="rounded-lg bg-muted px-2 py-2">
                <div className="text-xs text-muted-foreground">いいね</div>
                <div className="text-lg font-semibold text-foreground">
                  {whowatch.niceCount.toLocaleString()}
                </div>
              </div>
            </div>
          </>
        )}
        {/* コメント数・獲得ポイントは実機再検証の結果、信頼できるマッピングが未確定のため一時非表示。
            (要確認) comment_countは常に0で伝搬しない/item_countは公式ポイント値と不一致（詳細は完了報告参照） */}
      </div>

      {/* 詳細: プラットフォーム別ステータス・直近のイベント（実データのみ）は初期非表示 */}
      <button
        type="button"
        onClick={() => setDetailsOpen((v) => !v)}
        aria-expanded={detailsOpen}
        className="flex min-h-11 w-full items-center justify-between rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground"
      >
        詳細を見る
        <ChevronDown
          className={`size-4 text-muted-foreground transition-transform ${detailsOpen ? "rotate-180" : ""}`}
        />
      </button>
      {detailsOpen && (
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-card p-4">
            <DashboardPlatformStatus
              platforms={platforms}
              loading={platformsLoading}
              errorMessage={platformsError}
            />
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <EventTicker items={activityItems} loading={activityLoading} />
          </div>
        </div>
      )}
    </div>
  );
}
