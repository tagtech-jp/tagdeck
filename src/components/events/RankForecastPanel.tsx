"use client";

import { useEffect, useMemo, useState } from "react";
import { estimatePaceParameters } from "@/lib/events/monte-carlo";
import { forecastRank, type RankForecastOutput, type SnapshotLike } from "@/lib/whowatch/rank-forecast";

// E3: ranking_snapshots（実データ）から「目標順位の達成確率・必要 pt・必要個数・1 日あたり個数」をクライアント計算する。
// 期待倍率は rules_parsed（当たり倍率表）、基礎 pt は event_item_points（手入力 / 実測推定）。全て期待値・目安であり断定しない。

interface SnapshotRow {
  id: string;
  capturedAt: string;
  status: number | null;
  myRank: number | null;
  myPoint: number | null;
  entries: Array<{ rank: number; point: number; user_id: string | null; user_path: string | null; name: string }>;
}
interface ItemMaster {
  id: string;
  name: string;
  basePoint: number;
  priceJpy: number;
}
interface ItemPointRow {
  itemId: string;
  basePoint: number;
  source: string;
}
interface RulesParsed {
  expectedMultiplier: number | null;
  multiplierTable: Array<{ probability: number; multiplier: number }> | null;
  freeItem: { perDay: number; perGroup: boolean; hit: { probability: number; multiplier: number } | null } | null;
}

interface Props {
  eventId: string;
  whowatchEventId: number | null;
  targetRank: number;
  endTime: string;
  onTargetRankChange?: (rank: number) => void;
}

const TARGET_RANKS = [1, 2, 3, 4, 5];

export function RankForecastPanel({ eventId, whowatchEventId, targetRank: initialTargetRank, endTime, onTargetRankChange }: Props) {
  const [targetRank, setTargetRank] = useState(Math.min(5, Math.max(1, initialTargetRank || 5)));
  const [snapshots, setSnapshots] = useState<SnapshotRow[] | null>(null);
  const [items, setItems] = useState<ItemMaster[]>([]);
  const [eventKey, setEventKey] = useState<string | null>(null);
  const [rules, setRules] = useState<RulesParsed | null>(null);
  const [itemPoints, setItemPoints] = useState<ItemPointRow[]>([]);
  const [selectedItem, setSelectedItem] = useState<string>("");
  const [basePointInput, setBasePointInput] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // スナップショット（5 分毎に再取得）
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch(`/api/events/${eventId}/snapshots?limit=96`)
        .then((r) => (r.ok ? (r.json() as Promise<{ snapshots?: SnapshotRow[] }>) : { snapshots: [] }))
        .then((d: { snapshots?: SnapshotRow[] }) => {
          if (!cancelled) setSnapshots(d.snapshots ?? []);
        })
        .catch(() => {
          if (!cancelled) setSnapshots([]);
        });
    void load();
    const id = setInterval(() => {
      void load();
      setTick((t) => t + 1);
    }, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [eventId]);

  // アイテムマスタ（価格付き）と、whowatchEventId → event_key → ルール解析・基礎 pt
  useEffect(() => {
    let cancelled = false;
    fetch("/api/platforms/whowatch/items")
      .then((r) => (r.ok ? (r.json() as Promise<{ items?: ItemMaster[] }>) : { items: [] }))
      .then((d: { items?: ItemMaster[] }) => {
        if (!cancelled) setItems(d.items ?? []);
      })
      .catch(() => undefined);
    if (whowatchEventId === null) return;
    fetch("/api/platforms/whowatch/events/list")
      .then((r) => (r.ok ? (r.json() as Promise<{ open?: Array<{ id: number; eventKey: string }>; pre?: Array<{ id: number; eventKey: string }> }>) : { open: [], pre: [] }))
      .then(async (d: { open?: Array<{ id: number; eventKey: string }>; pre?: Array<{ id: number; eventKey: string }> }) => {
        const hit = [...(d.open ?? []), ...(d.pre ?? [])].find((e) => e.id === whowatchEventId);
        if (!hit || cancelled) return;
        setEventKey(hit.eventKey);
        const [detail, points] = await Promise.all([
          fetch(`/api/platforms/whowatch/events/${encodeURIComponent(hit.eventKey)}`).then((r) => (r.ok ? (r.json() as Promise<{ rulesParsed?: RulesParsed | null } | null>) : null)),
          fetch(`/api/platforms/whowatch/events/${encodeURIComponent(hit.eventKey)}/item-points`).then((r) => (r.ok ? (r.json() as Promise<{ items?: ItemPointRow[] }>) : { items: [] })),
        ]);
        if (cancelled) return;
        setRules(detail?.rulesParsed ?? null);
        setItemPoints(points?.items ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [whowatchEventId]);

  const expectedMultiplier = rules?.expectedMultiplier ?? null;
  const knownBase = itemPoints.find((p) => p.itemId === selectedItem)?.basePoint ?? null;
  const basePoint = basePointInput !== "" ? Number(basePointInput) : knownBase;

  const forecast: RankForecastOutput | null = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return null;
    const sorted = [...snapshots].sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());
    const latest = sorted[sorted.length - 1];
    const me = latest.myRank ? latest.entries.find((e) => e.rank === latest.myRank) ?? null : null;
    const myKey = me ? me.user_id ?? me.user_path ?? me.name : null;
    const myHistory = sorted.filter((s) => s.myPoint !== null).map((s) => ({ timestamp: new Date(s.capturedAt), score: s.myPoint as number }));
    const myPace = estimatePaceParameters(myHistory);
    const snaps: SnapshotLike[] = sorted.map((s) => ({ capturedAt: s.capturedAt, entries: s.entries, myPoint: s.myPoint }));
    return forecastRank({
      snapshots: snaps,
      myPoint: latest.myPoint ?? 0,
      myPaceMean: myPace.mean,
      myPaceStdDev: myPace.stdDev,
      targetRank,
      now: new Date(),
      endTime: new Date(endTime),
      itemBasePoint: basePoint && basePoint > 0 ? basePoint : null,
      expectedMultiplier: expectedMultiplier ?? 1,
      myKey,
    });
    // tick で 5 分毎に再計算（残り時間の更新）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshots, targetRank, endTime, basePoint, expectedMultiplier, tick]);

  const handleTargetRank = async (rank: number) => {
    setTargetRank(rank);
    onTargetRankChange?.(rank);
    try {
      await fetch(`/api/events/${eventId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetRank: rank }) });
    } catch {
      /* 表示は即時、保存失敗は次回操作で再試行 */
    }
  };

  const handleSaveBasePoint = async (source: "manual" | "estimated") => {
    if (!eventKey || !selectedItem || !basePoint || basePoint <= 0) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/platforms/whowatch/events/${encodeURIComponent(eventKey)}/item-points`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: selectedItem, basePoint: Math.round(basePoint), source }),
      });
      if (!res.ok) {
        setMsg("保存に失敗しました");
        return;
      }
      const d = (await res.json()) as { item: ItemPointRow };
      setItemPoints((prev) => [...prev.filter((p) => p.itemId !== selectedItem), d.item]);
      setMsg("基礎ポイントを保存しました");
    } catch {
      setMsg("通信エラー");
    } finally {
      setSaving(false);
    }
  };

  const handleEstimate = async () => {
    if (!eventKey || !selectedItem) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/platforms/whowatch/events/${encodeURIComponent(eventKey)}/item-points/estimate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simulatorId: eventId, itemId: selectedItem }),
      });
      const d = (await res.json()) as { ok: boolean; estimatedBasePoint?: number; message?: string; giftCount?: number; pointDelta?: number };
      if (d.ok && d.estimatedBasePoint) {
        setBasePointInput(String(d.estimatedBasePoint));
        setMsg(`実測から推定: ${d.estimatedBasePoint} pt/個（pt 増分 ${d.pointDelta} ÷ ${d.giftCount} 個）。「保存」で確定`);
      } else {
        setMsg(d.message ?? "推定できませんでした");
      }
    } catch {
      setMsg("通信エラー");
    } finally {
      setSaving(false);
    }
  };

  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-foreground">逆算と確率</h4>
        <span className="rounded-full bg-status-warning/10 px-2 py-0.5 text-xs text-status-warning">(要確認・目安)</span>
      </div>

      {/* 目標順位: 変えると即再計算 + 保存 */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground">目標順位</label>
        <select
          value={targetRank}
          onChange={(e) => void handleTargetRank(Number(e.target.value))}
          className="min-h-11 rounded-sm bg-muted px-3 py-2 text-sm text-foreground"
        >
          {TARGET_RANKS.map((r) => (
            <option key={r} value={r}>
              {r} 位
            </option>
          ))}
        </select>
        {forecast && (
          <span className="text-xs text-muted-foreground">
            スナップショット {forecast.snapshotCount} 枚 · ライバル {forecast.rivals.length} 名 · 残り {forecast.remainingDays} 日（{Math.round(forecast.remainingHours)} 時間）
          </span>
        )}
      </div>

      {snapshots === null ? (
        <div className="h-16 animate-pulse rounded-lg bg-muted" />
      ) : !forecast || forecast.rivals.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {snapshots.length < 2
            ? `スナップショットが ${snapshots.length} 枚です。5 分ごとの自動取得で 2 枚以上たまると計算できます`
            : forecast?.note ?? "計算できません"}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div className="rounded-lg bg-muted px-3 py-2">
              <div className="text-muted-foreground">目標 {targetRank} 位の達成確率</div>
              <div className="text-lg font-bold text-foreground">{forecast.rankProbability.toFixed(1)}%</div>
            </div>
            <div className="rounded-lg bg-muted px-3 py-2">
              <div className="text-muted-foreground">必要追加 pt（中央値 / 90%）</div>
              <div className="font-mono text-foreground">
                {fmt(forecast.requiredPoints.p50)} / {fmt(forecast.requiredPoints.p90)}
              </div>
            </div>
            <div className="rounded-lg bg-muted px-3 py-2">
              <div className="text-muted-foreground">必要個数（中央値 / 90%）</div>
              <div className="font-mono text-foreground">
                {forecast.itemsNeeded ? `${fmt(forecast.itemsNeeded.p50)} / ${fmt(forecast.itemsNeeded.p90)} 個` : "基礎 pt 未設定"}
              </div>
            </div>
            <div className="rounded-lg bg-muted px-3 py-2">
              <div className="text-muted-foreground">1 日あたり（中央値 / 90%）</div>
              <div className="font-mono text-foreground">
                {forecast.itemsPerDay ? `${fmt(forecast.itemsPerDay.p50)} / ${fmt(forecast.itemsPerDay.p90)} 個` : "—"}
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {forecast.note}
            {forecast.usedFinalDayCoefficient && `。最終日はライバルのペース ×${forecast.finalDayCoefficient}（仮置き・要確認）`}
          </p>
        </>
      )}

      {/* 期待倍率と基礎 pt */}
      <div className="space-y-2 border-t border-border pt-3">
        <div className="text-xs text-muted-foreground">
          期待倍率:{" "}
          {expectedMultiplier !== null ? (
            <span className="text-foreground">
              ×{expectedMultiplier}（
              {rules?.multiplierTable?.map((r) => `${r.probability}%→${r.multiplier}倍`).join(" / ")}）
            </span>
          ) : (
            <span>ルール本文から抽出できず ×1 で計算（要確認）</span>
          )}
          {rules?.freeItem && (
            <span className="ml-2">
              無料アイテム 1 日 {rules.freeItem.perGroup ? "グループ数×" : ""}
              {rules.freeItem.perDay} 個
              {rules.freeItem.hit ? `（${rules.freeItem.hit.probability}%で${rules.freeItem.hit.multiplier}倍）` : ""}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedItem}
            onChange={(e) => {
              setSelectedItem(e.target.value);
              setBasePointInput("");
              setMsg(null);
            }}
            className="min-h-11 min-w-40 flex-1 rounded-sm bg-muted px-3 py-2 text-sm text-foreground"
          >
            <option value="">アイテムを選択（基礎 pt を設定）</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
                {i.priceJpy > 0 ? `（¥${i.priceJpy.toLocaleString()}）` : ""}
                {itemPoints.find((p) => p.itemId === i.id) ? ` · ${itemPoints.find((p) => p.itemId === i.id)!.basePoint} pt` : ""}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            inputMode="numeric"
            placeholder={knownBase ? String(knownBase) : "基礎 pt（1 個あたり）"}
            value={basePointInput}
            onChange={(e) => setBasePointInput(e.target.value)}
            disabled={!selectedItem}
            className="min-h-11 w-40 rounded-sm bg-muted px-3 py-2 text-sm text-foreground disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void handleSaveBasePoint("manual")}
            disabled={saving || !selectedItem || !eventKey || !basePointInput}
            className="min-h-11 rounded-full bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            保存
          </button>
          <button
            type="button"
            onClick={() => void handleEstimate()}
            disabled={saving || !selectedItem || !eventKey}
            className="min-h-11 rounded-full border border-border bg-muted px-4 text-xs text-foreground disabled:opacity-50"
          >
            実測から推定
          </button>
        </div>
        {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
        <p className="text-xs text-muted-foreground">
          必要個数 = ceil(必要 pt ÷ (基礎 pt × 期待倍率))。基礎 pt は公式本文に無いため手入力（全ユーザー共有）。「実測から推定」は自分のスナップショット間の pt 増分 ÷ その間のギフト個数（ギフト保存は S1 以降）
        </p>
      </div>
    </div>
  );
}
