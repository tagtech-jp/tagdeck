"use client";

import Link from "next/link";
import type { PlatformSummary } from "@/hooks/useDashboardPlatforms";

type Props = {
  platforms: PlatformSummary[];
  loading: boolean;
  errorMessage: string | null;
};

function formatNumber(value: number | null): string {
  return value === null ? "-" : value.toLocaleString();
}

function formatLastPolledAt(value: string | null): string {
  if (!value) return "未取得";
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function StatusBadge({ platform }: { platform: PlatformSummary }) {
  if (!platform.isConnected) {
    return <span className="text-xs text-muted-foreground">未連携</span>;
  }
  if (platform.isLive) {
    return <span className="text-xs text-status-success">配信中</span>;
  }
  if (platform.isMonitoring) {
    return <span className="text-xs text-status-warning">監視中</span>;
  }
  return <span className="text-xs text-muted-foreground">連携済み</span>;
}

export function DashboardPlatformStatus({ platforms, loading, errorMessage }: Props) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-muted-foreground">配信アカウント</h3>
        {loading && <span className="text-xs text-muted-foreground">読込中</span>}
      </div>
      {errorMessage && (
        <div className="rounded-lg bg-muted px-3 py-2 text-xs text-destructive">
          {errorMessage}
        </div>
      )}
      <div className="grid grid-cols-1 gap-2">
        {platforms.map((platform) => {
          const content = (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">{platform.label}</div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {platform.accountLabel}:{" "}
                    <span className="font-mono text-foreground">
                      {platform.accountValue ?? "未設定"}
                    </span>
                  </div>
                </div>
                <StatusBadge platform={platform} />
              </div>
              {platform.isConnected && (
                <>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <div>
                      視聴者
                      <div className="text-foreground">{formatNumber(platform.viewerCount)}</div>
                    </div>
                    <div>
                      最高
                      <div className="text-foreground">{formatNumber(platform.peakViewerCount)}</div>
                    </div>
                    <div>
                      {platform.platform === "kick"
                        ? "フォロワー"
                        : platform.platform === "niconico"
                          ? "コメント"
                          : "ポイント"}
                      <div className="text-foreground">
                        {formatNumber(
                          platform.platform === "kick"
                            ? platform.followerCount
                            : platform.platform === "niconico"
                              ? platform.commentCount
                              : platform.currentPoints,
                        )}
                      </div>
                    </div>
                  </div>
                  {platform.lastPolledAt && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      最終取得: {formatLastPolledAt(platform.lastPolledAt)}
                    </div>
                  )}
                  {platform.liveUrl && (
                    <a
                      href={platform.liveUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 block truncate text-xs text-status-success hover:underline"
                    >
                      検出URL: {platform.liveUrl}
                    </a>
                  )}
                </>
              )}
            </>
          );

          // R9 迷2対策: 未連携カードはタップで連携画面へ直行（従来は非クリックのdivで行き止まりだった）
          if (platform.isConnected) {
            return (
              <div
                key={platform.platform}
                className="rounded-lg border border-border bg-card px-3 py-2"
              >
                {content}
              </div>
            );
          }
          return (
            <Link
              key={platform.platform}
              href="/settings/platforms"
              className="block rounded-lg border border-border bg-card px-3 py-2 transition-colors hover:bg-accent"
            >
              {content}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
