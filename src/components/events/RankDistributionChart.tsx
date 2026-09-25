"use client";

import dynamic from "next/dynamic";

// Cloudflare Workers バンドルサイズ削減のため recharts は遅延ロード
const Inner = dynamic(() => import("./RankDistributionChartInner"), {
  ssr: false,
  loading: () => <div className="h-32 animate-pulse rounded-lg bg-muted" />,
});

interface Props {
  distribution: Record<string, number>;
  targetRank: number;
}

export function RankDistributionChart({ distribution, targetRank }: Props) {
  return <Inner distribution={distribution} targetRank={targetRank} />;
}
