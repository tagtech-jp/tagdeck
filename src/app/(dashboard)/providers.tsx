"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { LiveConnectionProvider } from "@/components/live/LiveConnectionProvider";
import { SessionKeeper } from "@/components/auth/SessionKeeper";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      {/* ログインを期限の前に取り直し、開きっぱなしの画面でもログインが切れないようにする（2026-10-03） */}
      <SessionKeeper />
      {/* ライブ接続はページ遷移で切れないよう、レイアウト直下で保持する */}
      <LiveConnectionProvider>{children}</LiveConnectionProvider>
    </QueryClientProvider>
  );
}
