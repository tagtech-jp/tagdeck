"use client";

// 配信後の振り返りレポート（2026-10-06 社長指示）。/live の下に、直近の配信（ギフトのある live_id）を選んで
// 合計・人数・上位リスナー・初めての人・よく出たアイテム・盛り上がった 10 分間を出す。
// 開いたときと「更新」を押したときだけ読む（配信中に勝手に読み直さない）。

import { useCallback, useState } from "react";
import type { StreamReport } from "@/lib/live/stream-report";

interface StreamSummary {
  streamId: string;
  firstAt: string;
  lastAt: string;
  gifts: number;
}

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;
const time = (iso: string) => new Date(iso).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });

export function StreamReportPanel() {
  const [open, setOpen] = useState(false);
  const [streams, setStreams] = useState<StreamSummary[]>([]);
  const [streamId, setStreamId] = useState<string | null>(null);
  const [report, setReport] = useState<StreamReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/live/report${id ? `?streamId=${encodeURIComponent(id)}` : ""}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { streams: StreamSummary[]; streamId: string | null; report: StreamReport | null };
      setStreams(body.streams);
      setStreamId(body.streamId);
      setReport(body.report);
    } catch (e) {
      setError(`レポートを取得できませんでした（${e instanceof Error ? e.message : String(e)}）`);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (next) void load(null);
          }}
          className="min-h-11 text-sm font-bold text-foreground"
        >
          {open ? "▼" : "▶"} 配信の振り返りレポート
        </button>
        {open && (
          <>
            <select
              value={streamId ?? ""}
              onChange={(e) => void load(e.target.value || null)}
              className="min-h-11 rounded-md border border-border bg-background px-2 text-xs text-foreground"
              aria-label="配信を選ぶ"
            >
              {streams.map((s) => (
                <option key={s.streamId} value={s.streamId}>
                  {day(s.firstAt)} {time(s.firstAt)}〜{time(s.lastAt)}（ギフト {s.gifts} 件）
                </option>
              ))}
            </select>
            <button type="button" onClick={() => void load(streamId)} className="min-h-11 rounded-full border border-border bg-muted px-3 text-xs text-foreground hover:border-foreground/30">
              更新
            </button>
          </>
        )}
      </div>
      {open && (
        <div className="mt-3 space-y-3 text-sm">
          {loading && <p className="text-xs text-muted-foreground">読み込み中…</p>}
          {error && <p className="text-xs text-destructive">{error}</p>}
          {!loading && !error && !report && <p className="text-xs text-muted-foreground">まだギフトの記録がある配信がありません（自分の配信に接続している間のギフトが記録されます）</p>}
          {report && (
            <>
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span>
                  合計 <span className="text-lg font-bold">{yen(report.totalYen)}</span>
                </span>
                <span>ギフト {report.giftCount.toLocaleString("ja-JP")} 件</span>
                <span>投げた人 {report.giverCount} 人{report.anonymousGiftCount > 0 ? `（ほか匿名 ${report.anonymousGiftCount} 件）` : ""}</span>
                {report.peak && report.peak.totalYen > 0 && (
                  <span>
                    いちばん盛り上がった 10 分: {time(report.peak.from)}〜{time(report.peak.to)}（{yen(report.peak.totalYen)}・{report.peak.gifts} 件）
                  </span>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <section>
                  <h5 className="mb-1 text-xs font-bold text-muted-foreground">上位リスナー</h5>
                  <ol className="space-y-0.5">
                    {report.topGivers.map((g, i) => (
                      <li key={`${g.name}-${i}`}>
                        {i + 1}. {g.name} — {yen(g.totalYen)}（{g.gifts} 回）
                      </li>
                    ))}
                  </ol>
                </section>
                <section>
                  <h5 className="mb-1 text-xs font-bold text-muted-foreground">この配信で初めて投げた人</h5>
                  {report.firstTimers.length === 0 ? <p className="text-xs text-muted-foreground">いません</p> : <p>{report.firstTimers.join("・")}</p>}
                </section>
                <section>
                  <h5 className="mb-1 text-xs font-bold text-muted-foreground">金額の多いアイテム</h5>
                  <ol className="space-y-0.5">
                    {report.topItems.map((it) => (
                      <li key={it.name}>
                        {it.name} ×{it.count.toLocaleString("ja-JP")} — {yen(it.totalYen)}
                      </li>
                    ))}
                  </ol>
                </section>
              </div>
              <p className="text-xs text-muted-foreground">※ 金額は単価が分かるギフトだけの合計です。コメント数・視聴者数は記録していないため出していません</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
