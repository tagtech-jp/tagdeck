"use client";

// /live の順位パネル（2026-10-05 社長指示「追い上げアラート：警告＋効果音」）。
// 開催中の自分のイベントごとに、順位・上下との差・目標までの差を出し、追い上げ・抜かれた・目標割れを
// 赤く出して警告音を 1 回鳴らす。ランキングは 5 分ごとの同期なので、1 分ごとに読み直せば十分。

import { useEffect, useRef, useState } from "react";
import { synthRankAlert } from "@/lib/se/engine";
import type { ItemsNeeded, ItemsNeededStatsView, RankStatus } from "@/lib/live/rank-alert";
import { useLiveConnection } from "./LiveConnectionProvider";

const REFRESH_MS = 60_000;

interface RankEvent {
  simulatorId: string;
  name: string;
  status: RankStatus;
  /** 目標まで・1 つ上まで の「あと◯個」（2026-10-06。イベントの基礎 pt が未登録なら空） */
  itemsToTarget?: ItemsNeeded[];
  itemsToAbove?: ItemsNeeded[];
  /** ルール本文の表（重量表）から出した統計（2026-10-07。表が無いイベントは null） */
  statsToTarget?: ItemsNeededStatsView | null;
  statsToAbove?: ItemsNeededStatsView | null;
}

const itemsText = (items: ItemsNeeded[] | undefined) => (items && items.length > 0 ? items.map((i) => `${i.name} ${i.count.toLocaleString("ja-JP")}個`).join("・") : null);
const num = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });
/** 「中央値 12 個・90% で 19 個（1 個 平均 85kg ± 94）」 */
const statsText = (s: ItemsNeededStatsView | null | undefined) =>
  s ? `中央値 ${num(s.p50)} 個・90% で ${num(s.p90)} 個（1 個 平均 ${num(s.meanPerItem)}${s.unit ?? ""} ± ${num(s.sdPerItem)}）` : null;

const pt = (n: number) => `${n.toLocaleString("ja-JP")}pt`;

export function RankAlertPanel() {
  const { volume } = useLiveConnection();
  const [events, setEvents] = useState<RankEvent[]>([]);
  const volumeRef = useRef(volume);
  /** 鳴らし済みの警告（simulatorId + 種類 + スナップショット時刻）。同じ警告で何度も鳴らさない */
  const alertedRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/live/rank-status");
        if (!res.ok) return;
        const body = (await res.json()) as { events?: RankEvent[] };
        if (cancelled) return;
        const list = body.events ?? [];
        const keys = list.flatMap((ev) => ev.status.alerts.map((a) => `${ev.simulatorId}|${a.kind}|${ev.status.capturedAt}`));
        // 画面を開いた直後に既に出ている警告は鳴らさない（開くたびに鳴るのを防ぐ）
        if (alertedRef.current === null) alertedRef.current = new Set(keys);
        else if (keys.some((k) => !alertedRef.current!.has(k))) {
          for (const k of keys) alertedRef.current.add(k);
          synthRankAlert(volumeRef.current / 100);
        }
        setEvents(list);
      } catch {
        // 取れなければ前回の表示のまま（次の周期で取り直す）
      }
    };
    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (events.length === 0) return null;
  return (
    <div className="space-y-2">
      {events.map(({ simulatorId, name, status: s, itemsToTarget, itemsToAbove, statsToTarget, statsToAbove }) => {
        const alerting = s.alerts.length > 0;
        return (
          <div key={simulatorId} className={`rounded-xl border p-4 ${alerting ? "border-destructive bg-destructive/10" : "border-border bg-card"}`}>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-sm font-bold">{name}</span>
              <span className="text-lg font-bold">{s.myRank} 位</span>
              <span className="text-sm text-muted-foreground">{pt(s.myPoint)}</span>
              {s.above && <span className="text-sm">上の{s.above.name}さんまで {pt(s.above.gap)}</span>}
              {s.below && (
                <span className="text-sm">
                  下の{s.below.name}さんと {pt(s.below.gap)}
                  {s.below.closingPerHour !== null && s.below.closingPerHour > 0 ? `（1 時間に ${pt(s.below.closingPerHour)} 詰められるペース）` : ""}
                </span>
              )}
              {s.target && <span className="text-sm">{s.target.gap > 0 ? `目標 ${s.target.rank} 位まで ${pt(s.target.gap)}` : `目標 ${s.target.rank} 位圏内（余裕 ${pt(-s.target.gap)}）`}</span>}
              <span className="ml-auto text-xs text-muted-foreground">{new Date(s.capturedAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })} 時点</span>
            </div>
            {(itemsText(itemsToAbove) || (s.target && s.target.gap > 0 && itemsText(itemsToTarget))) && (
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {itemsText(itemsToAbove) && <span>1 つ上を抜くには: {itemsText(itemsToAbove)}</span>}
                {s.target && s.target.gap > 0 && itemsText(itemsToTarget) && <span>目標 {s.target.rank} 位まで: {itemsText(itemsToTarget)}</span>}
              </div>
            )}
            {(statsText(statsToAbove) || (s.target && s.target.gap > 0 && statsText(statsToTarget))) && (
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {statsText(statsToAbove) && <span>統計・1 つ上を抜くには: {statsText(statsToAbove)}</span>}
                {s.target && s.target.gap > 0 && statsText(statsToTarget) && <span>統計・目標 {s.target.rank} 位まで: {statsText(statsToTarget)}</span>}
              </div>
            )}
            {alerting && (
              <ul className="mt-2 space-y-1">
                {s.alerts.map((a) => (
                  <li key={a.kind} className="text-sm font-bold text-destructive">
                    ⚠ {a.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
