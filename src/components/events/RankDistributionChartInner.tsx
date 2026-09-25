"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Cell,
} from "recharts";
import { useCssTokens } from "@/lib/css-tokens";

interface Props {
  distribution: Record<string, number>;
  targetRank: number;
}

const CHART_TOKENS = {
  axisText: ["--color-smoke", "#95979e"],
  tooltipBg: ["--popover", "#111111"],
  tooltipBorder: ["--border", "#4a4b50"],
  inTarget: ["--status-success", "#10b981"],
  outTarget: ["--color-slate-edge", "#4a4b50"],
} as const;

export default function RankDistributionChartInner({ distribution, targetRank }: Props) {
  const palette = useCssTokens(CHART_TOKENS);
  const total = Object.values(distribution).reduce((a, b) => a + b, 0);

  const data = Object.entries(distribution)
    .map(([rank, count]) => ({ rank: parseInt(rank, 10), count }))
    .filter((d) => !isNaN(d.rank) && d.rank < 9000) // 手動入力の仮順位を除外
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 30);

  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">
        データが不足しています
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2 text-xs text-muted-foreground">最終順位の分布（10,000 試行）</div>
      <div style={{ width: "100%", height: 120 }}>
        <ResponsiveContainer width="100%" height={120} minWidth={0}>
          <BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="rank"
              tick={{ fontSize: 9, fill: palette.axisText }}
              tickFormatter={(v) => `${v}位`}
            />
            <YAxis hide />
            <Tooltip
              contentStyle={{
                backgroundColor: palette.tooltipBg,
                border: `1px solid ${palette.tooltipBorder}`,
                borderRadius: "0.5rem",
                fontSize: "0.75rem",
              }}
              formatter={(value) => [
                `${(((value as number) / total) * 100).toFixed(1)}%`,
                "確率",
              ]}
              labelFormatter={(label) => `${label} 位`}
            />
            <Bar dataKey="count">
              {data.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.rank <= targetRank ? palette.inTarget : palette.outTarget}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm bg-status-success" />
          目標順位以内
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm bg-slate-edge" />
          目標外
        </span>
      </div>
    </div>
  );
}
