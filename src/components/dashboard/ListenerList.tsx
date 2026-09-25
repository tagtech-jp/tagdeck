"use client";

import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ListenerCard } from "./ListenerCard";
import { useCrmFilterStore } from "@/stores/crm-filter-store";
import { usePlatformStore } from "@/stores/platform-store";
import type { Listener } from "@/types/listener";
import type { Platform } from "@/types/platform";

// プラットフォームごとの取得実態に即した正直な空状態文言。
// ふわっち: 個人別リスナー情報は公式に取得不可（集計値のみホーム統計タブで表示）。
// ニコ生: 個別リスナー連携は未実装（視聴者数/コメント数の集計のみ）。
const PLATFORM_EMPTY_MESSAGES: Record<Platform, string> = {
  whowatch:
    "ふわっちは個人別のリスナー情報を公式に取得できないため、CRMへの自動反映はありません。合計値（コメント数・獲得pt・いいね）はホームの統計タブに表示されます",
  kick: "配信イベントを受信すると、ここに表示されます",
  niconico: "ニコ生の個別リスナー連携は未対応です（視聴者数・コメント数の集計のみ対応）",
};

export function ListenerList({
  listeners,
  emptyMessage = "配信イベントを受信すると、ここにリスナーが表示されます",
}: {
  listeners: Listener[];
  emptyMessage?: string;
}) {
  const { searchQuery, setSearchQuery, sortKey, sortDirection } = useCrmFilterStore();
  const { selectedPlatform } = usePlatformStore();

  const filtered = useMemo(() => {
    let result = listeners;

    if (selectedPlatform !== "all") {
      result = result.filter((l) => l.platform === selectedPlatform);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (l) =>
          l.displayName.toLowerCase().includes(q) ||
          l.nickname?.toLowerCase().includes(q) ||
          l.notes?.toLowerCase().includes(q)
      );
    }

    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "lastSeenAt") {
        cmp = a.lastSeenAt.getTime() - b.lastSeenAt.getTime();
      } else if (sortKey === "totalGiftAmount") {
        cmp = a.totalGiftAmount - b.totalGiftAmount;
      } else if (sortKey === "totalCommentCount") {
        cmp = a.totalCommentCount - b.totalCommentCount;
      } else if (sortKey === "displayName") {
        cmp = a.displayName.localeCompare(b.displayName);
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });

    return result;
  }, [listeners, searchQuery, sortKey, sortDirection, selectedPlatform]);

  const emptyText =
    selectedPlatform === "all" ? emptyMessage : PLATFORM_EMPTY_MESSAGES[selectedPlatform];

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 border-b border-border bg-background p-3">
        <Input
          placeholder="リスナーを検索..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <div className="mt-2 text-xs text-muted-foreground">{filtered.length} 件</div>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-3">
          {filtered.map((listener) => (
            <ListenerCard key={listener.id} listener={listener} />
          ))}
          {filtered.length === 0 && (
            <div className="mx-auto max-w-xs py-12 text-center text-sm text-muted-foreground">
              {emptyText}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
