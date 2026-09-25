"use client";

import { useState } from "react";
import type { WhowatchMonitorState } from "@/hooks/useWhowatchMonitor";
import { MonitorControlCard } from "@/components/dashboard/MonitorControlCard";

type Props = {
  whowatch: WhowatchMonitorState & { toggleMonitoring: () => Promise<void> };
  compact?: boolean;
};

export function MonitorButton({ whowatch, compact = false }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    if (!whowatch.isConnected) return;
    setBusy(true);
    setError(null);
    try {
      await whowatch.toggleMonitoring();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ふわっち監視の切り替えに失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const status = whowatch.loading
    ? { label: "読込中", tone: "loading" as const }
    : !whowatch.isConnected
      ? { label: "未連携", tone: "idle" as const }
      : whowatch.isLive
        ? { label: "配信中", tone: "live" as const }
        : whowatch.isMonitoring
          ? { label: "監視中", tone: "monitoring" as const }
          : { label: "停止中", tone: "idle" as const };

  return (
    <MonitorControlCard
      platformName="ふわっち"
      statusLabel={status.label}
      statusTone={status.tone}
      actionLabel={
        whowatch.isConnected
          ? whowatch.isMonitoring
            ? "停止"
            : "監視開始"
          : "未連携"
      }
      isActive={whowatch.isMonitoring}
      disabled={!whowatch.isConnected}
      busy={busy}
      errorMessage={error ?? whowatch.errorMessage}
      onClick={handleClick}
      compact={compact}
    />
  );
}
