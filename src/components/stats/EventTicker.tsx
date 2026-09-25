import type { StreamActivityItem } from "@/app/api/stream-activity/route";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import { PlatformScopeBadge } from "@/components/dashboard/PlatformScopeBadge";

const EVENT_LABELS: Record<StreamActivityItem["type"], string> = {
  comment: "コメント",
  gift: "ギフト",
};

const EVENT_COLORS: Record<StreamActivityItem["type"], string> = {
  comment: "text-foreground",
  gift: "text-ember-pulse",
};

export function EventTicker({
  items,
  loading,
}: {
  items: StreamActivityItem[];
  loading: boolean;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">直近のイベント</span>
        <PlatformScopeBadge platforms={["kick"]} />
      </div>
      {loading ? (
        <div className="h-8 animate-pulse rounded bg-muted" />
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          コメント・ギフトを受信すると、ここに表示されます
        </p>
      ) : (
        <div className="max-h-48 space-y-1 overflow-y-auto">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 border-b border-border py-1.5 text-xs last:border-0"
            >
              <span className={`font-bold ${EVENT_COLORS[item.type]}`}>
                {EVENT_LABELS[item.type]}
              </span>
              <span className="flex-1 truncate text-foreground">
                {item.listenerName}
                {item.amount != null && ` ${item.amount.toLocaleString()} 件`}
                {item.message && `: ${item.message}`}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(item.occurredAt), { locale: ja, addSuffix: true })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
