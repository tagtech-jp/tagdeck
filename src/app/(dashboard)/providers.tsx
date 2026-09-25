"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { LiveConnectionProvider } from "@/components/live/LiveConnectionProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      {/* ライブ接続はページ遷移で切れないよう、レイアウト直下で保持する */}
      <LiveConnectionProvider>{children}</LiveConnectionProvider>
    </QueryClientProvider>
  );
}
