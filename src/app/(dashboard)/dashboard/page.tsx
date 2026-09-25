"use client";

import { useWhowatchMonitor } from "@/hooks/useWhowatchMonitor";
import { StatsPanel } from "@/components/dashboard/StatsPanel";
import { ListenerList } from "@/components/dashboard/ListenerList";
import { MonitorButton } from "@/components/dashboard/MonitorButton";
import { KickMonitorButton } from "@/components/dashboard/KickMonitorButton";
import { NiconicoMonitorButton } from "@/components/dashboard/NiconicoMonitorButton";
import { useDashboardListeners } from "@/hooks/useDashboardListeners";
import { useDashboardPlatforms } from "@/hooks/useDashboardPlatforms";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function DashboardPage() {
  const whowatch = useWhowatchMonitor();
  const { listeners, loading, errorMessage } = useDashboardListeners();
  const platforms = useDashboardPlatforms();

  return (
    <Tabs defaultValue="stats" className="flex h-full flex-col">
      <div className="border-b border-border px-4 pt-3">
        <TabsList className="w-full">
          <TabsTrigger value="stats" className="flex-1">
            統計
          </TabsTrigger>
          <TabsTrigger value="crm" className="flex-1">
            CRM（Kickのみ）
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="stats" className="p-4">
        {/* 主要操作: ふわっちの開始/停止を主要操作とし、他プラットフォームはコンパクトな副次操作にする */}
        <div className="mb-4 space-y-2">
          <MonitorButton whowatch={whowatch} />
          <div className="flex gap-2">
            <KickMonitorButton compact />
            <NiconicoMonitorButton compact />
          </div>
        </div>
        <StatsPanel
          whowatch={whowatch}
          platforms={platforms.platforms}
          platformsLoading={platforms.loading}
          platformsError={platforms.errorMessage}
        />
      </TabsContent>

      <TabsContent value="crm" className="flex flex-1 flex-col overflow-hidden">
        {loading && (
          <div className="px-4 pt-3 text-xs text-muted-foreground">
            配信ユーザー ID に紐づく CRM を読み込み中
          </div>
        )}
        {errorMessage && (
          <div className="px-4 pt-3 text-xs text-destructive">{errorMessage}</div>
        )}
        <ListenerList
          listeners={listeners}
          emptyMessage="配信イベントを受信すると、ここにリスナーが表示されます"
        />
      </TabsContent>
    </Tabs>
  );
}
