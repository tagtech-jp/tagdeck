import type { Listener } from "@/types/listener";
import { Badge } from "@/components/ui/badge";
import { PLATFORM_LABELS, PLATFORM_COLORS } from "@/types/platform";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";

const RANK_LABELS: Record<Listener["rank"], string> = {
  top: "TOP",
  vip: "VIP",
  regular: "常連",
  newcomer: "新規",
};

// Huly Tag/Chip: category color at 12% + category-colored text.
// VIP / 常連 use Snow text: purple/blue on the tinted charcoal fall below AA 4.5.
const RANK_COLORS: Record<Listener["rank"], string> = {
  top: "bg-tier-top/12 text-tier-top",
  vip: "bg-tier-vip/12 text-foreground",
  regular: "bg-tier-regular/12 text-foreground",
  newcomer: "bg-tier-newcomer/12 text-tier-newcomer",
};

// Avatar initial on the platform brand color. White fails AA on Kick green
// (1.4:1) and ふわっち pink (2.9:1); Void reads on both. Snow stays on ニコ生.
const AVATAR_TEXT: Record<Listener["platform"], string> = {
  whowatch: "text-void",
  kick: "text-void",
  niconico: "text-snow",
};

export function ListenerCard({ listener }: { listener: Listener }) {
  return (
    <div className="rounded-lg bg-card p-3">
      <div className="flex items-start gap-3">
        <div
          className={`relative flex size-10 shrink-0 items-center justify-center rounded-full font-bold ${AVATAR_TEXT[listener.platform]}`}
          style={{ backgroundColor: PLATFORM_COLORS[listener.platform] }}
        >
          {listener.displayName.charAt(0)}
          {listener.isOnline && (
            <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-card bg-status-success" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {listener.nickname ?? listener.displayName}
            </span>
            <Badge className={`px-1.5 py-0 text-xs ${RANK_COLORS[listener.rank]}`}>
              {RANK_LABELS[listener.rank]}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {PLATFORM_LABELS[listener.platform]}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            累計 {listener.totalGiftAmount.toLocaleString()} pt
            ・コメント {listener.totalCommentCount}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            最終 {formatDistanceToNow(listener.lastSeenAt, { locale: ja, addSuffix: true })}
          </div>
          {listener.notes && (
            <div className="mt-1 rounded bg-muted px-2 py-1 text-xs text-foreground">
              📝 {listener.notes}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
