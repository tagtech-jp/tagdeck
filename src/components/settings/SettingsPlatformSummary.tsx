"use client";

import Link from "next/link";
import { useDashboardPlatforms } from "@/hooks/useDashboardPlatforms";

/**
 * 設定ホーム最上段のプラットフォーム連携サマリー（R9 迷1/迷2対策）。
 * 「設定」タップ後すぐに連携状況が分かり、未連携ならそのままタップして連携画面へ進める。
 */
export function SettingsPlatformSummary() {
  const { platforms, loading } = useDashboardPlatforms();

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-foreground">プラットフォーム連携</h4>
        <Link href="/settings/platforms" className="text-xs text-primary hover:underline">
          連携を管理する
        </Link>
      </div>
      {loading ? (
        <div className="h-10 animate-pulse rounded-lg bg-muted" />
      ) : (
        <div className="space-y-1.5">
          {platforms.map((p) => (
            <Link
              key={p.platform}
              href="/settings/platforms"
              className="flex min-h-11 items-center justify-between rounded-lg bg-muted px-3 text-sm transition-colors hover:bg-accent"
            >
              <span className="text-foreground">{p.label}</span>
              <span
                className={
                  p.isConnected
                    ? "text-xs text-muted-foreground"
                    : "text-xs font-medium text-primary"
                }
              >
                {p.isConnected ? "連携済み" : "未連携（タップして連携）"}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
