"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LiveCockpit } from "@/components/live/LiveCockpit";
import { SeMappingTab } from "@/components/live/SeMappingTab";

function LivePageInner() {
  const sp = useSearchParams();
  const debug = sp.get("debug") === "1";
  return (
    <Tabs defaultValue="live" className="flex h-full flex-col">
      <div className="border-b border-border px-4 pt-3">
        <h2 className="mb-2 text-xl font-bold text-foreground">ライブコックピット</h2>
        <TabsList className="w-full">
          <TabsTrigger value="live" className="flex-1">
            ライブ
          </TabsTrigger>
          <TabsTrigger value="se" className="flex-1">
            SE
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="live" className="p-4">
        <LiveCockpit debug={debug} />
      </TabsContent>
      <TabsContent value="se" className="p-4">
        <SeMappingTab />
      </TabsContent>
    </Tabs>
  );
}

export default function LivePage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">読み込み中...</div>}>
      <LivePageInner />
    </Suspense>
  );
}
