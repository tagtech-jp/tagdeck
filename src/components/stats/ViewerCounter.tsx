import type { StreamStats } from "@/types/stats";
import { PLATFORM_LABELS, PLATFORM_COLORS } from "@/types/platform";

export function ViewerCounter({ stats }: { stats: StreamStats }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {PLATFORM_LABELS[stats.platform]}・視聴者数
        </span>
        <span
          className="size-2 animate-pulse rounded-full"
          style={{ backgroundColor: PLATFORM_COLORS[stats.platform] }}
        />
      </div>
      <div className="text-4xl font-bold text-foreground">{stats.viewerCount}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        ピーク {stats.peakViewerCount}
      </div>
    </div>
  );
}
