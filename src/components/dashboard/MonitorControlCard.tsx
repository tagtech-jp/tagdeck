"use client";

import { Play, Square } from "lucide-react";

type StatusTone = "live" | "monitoring" | "idle" | "error" | "loading";

type Props = {
  platformName: string;
  statusLabel: string;
  statusTone: StatusTone;
  actionLabel: string;
  isActive: boolean;
  disabled?: boolean;
  busy?: boolean;
  errorMessage?: string | null;
  onClick: () => void;
  /** true: 横並びの小型チップ表示（副次プラットフォーム用）。false: 大型カード表示（主要操作用）。 */
  compact?: boolean;
};

const statusClass: Record<StatusTone, string> = {
  live: "bg-status-success/10 text-status-success border-status-success/30",
  monitoring: "bg-primary/10 text-primary border-primary/30",
  idle: "bg-muted text-muted-foreground border-border",
  error: "bg-destructive/10 text-destructive border-destructive/30",
  loading: "bg-status-warning/10 text-status-warning border-status-warning/30",
};

export function MonitorControlCard({
  platformName,
  statusLabel,
  statusTone,
  actionLabel,
  isActive,
  disabled = false,
  busy = false,
  errorMessage,
  onClick,
  compact = false,
}: Props) {
  const ActionIcon = isActive ? Square : Play;

  if (compact) {
    return (
      <div className="min-w-0 flex-1">
        <button
          onClick={onClick}
          disabled={disabled || busy}
          aria-label={`${platformName} ${actionLabel}`}
          className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-full border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${statusClass[statusTone]}`}
        >
          <span className="truncate">
            {platformName}・{busy ? "処理中" : statusLabel}
          </span>
          <ActionIcon className="size-3.5 shrink-0" aria-hidden />
        </button>
        {errorMessage && (
          <div className="mt-1 truncate text-xs text-destructive">{errorMessage}</div>
        )}
      </div>
    );
  }

  return (
    <div className="min-w-0 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">{platformName}</span>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusClass[statusTone]}`}
        >
          {statusLabel}
        </span>
      </div>
      <button
        onClick={onClick}
        disabled={disabled || busy}
        aria-label={`${platformName} ${actionLabel}`}
        className={`mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-full text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          isActive
            ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
            : "bg-primary text-primary-foreground hover:bg-primary/90"
        }`}
      >
        <ActionIcon className="size-4" aria-hidden />
        <span className="truncate">{busy ? "処理中" : actionLabel}</span>
      </button>
      {errorMessage && (
        <div className="mt-2 truncate text-xs text-destructive">{errorMessage}</div>
      )}
    </div>
  );
}
