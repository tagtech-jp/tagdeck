"use client";

import { ListenerList } from "@/components/dashboard/ListenerList";
import { useDashboardListeners } from "@/hooks/useDashboardListeners";

export default function CrmPage() {
  const { listeners, loading, errorMessage } = useDashboardListeners();

  return (
    <div className="flex h-[calc(100vh-65px)] flex-col">
      <div className="px-4 pt-4">
        <h2 className="text-xl font-bold text-foreground">リスナー CRM（Kickのみ）</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          個人別リスナー情報はKickのみ自動反映されます
        </p>
        {loading && (
          <p className="mt-2 text-xs text-muted-foreground">読み込み中...</p>
        )}
        {errorMessage && (
          <p className="mt-2 text-xs text-destructive">{errorMessage}</p>
        )}
      </div>
      <div className="mt-4 flex-1 overflow-hidden">
        <ListenerList
          listeners={listeners}
          emptyMessage="配信イベントを受信すると、ここにリスナーが表示されます"
        />
      </div>
    </div>
  );
}
