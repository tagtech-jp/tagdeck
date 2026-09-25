"use client";

import { useState } from "react";
import { useKickMonitor } from "@/hooks/useKickMonitor";
import { MonitorControlCard } from "@/components/dashboard/MonitorControlCard";

export function KickMonitorButton({ compact = false }: { compact?: boolean }) {
  const { state, startMonitoring, stopMonitoring } = useKickMonitor();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    if (!state.username) return;
    setBusy(true);
    setError(null);
    try {
      if (state.isMonitoring) {
        await stopMonitoring();
      } else {
        await startMonitoring();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  const status =
    !state.username
      ? { label: "未連携", tone: "idle" as const }
      : state.status === "connecting"
        ? { label: "接続中", tone: "loading" as const }
        : state.status === "online"
          ? { label: "配信中", tone: "live" as const }
          : state.status === "offline"
            ? { label: "監視中", tone: "monitoring" as const }
            : state.status === "error"
              ? { label: "エラー", tone: "error" as const }
              : { label: "停止中", tone: "idle" as const };

  return (
    <MonitorControlCard
      platformName="Kick"
      statusLabel={status.label}
      statusTone={status.tone}
      actionLabel={
        state.username ? (state.isMonitoring ? "停止" : "監視開始") : "未連携"
      }
      isActive={state.isMonitoring}
      disabled={!state.username}
      busy={busy}
      errorMessage={error}
      onClick={handleClick}
      compact={compact}
    />
  );
}
