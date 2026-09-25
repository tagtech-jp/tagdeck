"use client";

import { useEffect, useMemo, useState } from "react";
import { useCssTokens } from "@/lib/css-tokens";
import { Trash2 } from "lucide-react";
import { useEventForecast, type EventSimulatorRow } from "@/hooks/useEventSimulator";
import { useHistoricalPace } from "@/hooks/useHistoricalPace";
import { useEventStrategy, type ItemMasterEntry } from "@/hooks/useEventStrategy";
import { RankDistributionChart } from "./RankDistributionChart";
import { RivalsList } from "./RivalsList";
import { EventSettingsEditor } from "./EventSettingsEditor";
import { RankForecastPanel } from "./RankForecastPanel";

// E4: 「攻略」セクションは既定で非表示（コードは残す）。NEXT_PUBLIC_FEATURE_STRATEGY_PANEL=1 で表示
const SHOW_STRATEGY_PANEL = process.env.NEXT_PUBLIC_FEATURE_STRATEGY_PANEL === "1";
import { createClient } from "@/lib/supabase/client";
import {
  simulateRankingProbability,
  estimatePaceParameters,
} from "@/lib/events/monte-carlo";
import { matchEventTemplate, DEFAULT_EVENT_TEMPLATE } from "@/lib/events/event-templates";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Props {
  event: EventSimulatorRow;
  /** 削除完了時に呼ばれる（一覧からの除去は呼び出し元の責務） */
  onDeleted?: () => void;
}

type PastHistoryRow = {
  name: string;
  final_score: number | null;
  final_rank: number | null;
  achieved: boolean;
  event_type: string;
  start_time: string;
};

const STATUS_COLORS = {
  ahead: "text-status-success",
  on_track: "text-primary",
  at_risk: "text-status-warning",
  impossible: "text-destructive",
  completed: "text-status-success",
} as const;

const STATUS_LABELS = {
  ahead: "余裕",
  on_track: "順調",
  at_risk: "注意",
  impossible: "困難",
  completed: "達成",
} as const;

// Colors come from globals.css at runtime (single source of truth)
const SPARKLINE_TOKENS = {
  baseline: ["--status-success", "#10b981"],
  line: ["--primary", "#5683da"],
  axisText: ["--color-smoke", "#95979e"],
} as const;

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  if (h > 0) return `${h}時間${m}分`;
  return `${m}分`;
}

export function EventDashboard({ event, onDeleted }: Props) {
  const { forecast } = useEventForecast(event);
  const { data: historicalPace } = useHistoricalPace(event.id, event.eventType);
  // R1: イベント型テンプレート解決（whowatch連携イベントのみ・既存の開催中イベント一覧APIを再利用）
  const [strategyTemplate, setStrategyTemplate] = useState(DEFAULT_EVENT_TEMPLATE);
  useEffect(() => {
    if (event.platform !== "whowatch" || !event.whowatchEventId) {
      // effect 内の同期 setState を避ける（react-hooks/set-state-in-effect）
      queueMicrotask(() => setStrategyTemplate(DEFAULT_EVENT_TEMPLATE));
      return;
    }
    let cancelled = false;
    fetch("/api/platforms/whowatch/events")
      .then((r) => (r.ok ? r.json() : { open: [] }))
      .then((data: { open?: Array<{ id: number; eventKey: string }> }) => {
        if (cancelled) return;
        const match = data.open?.find((e) => e.id === event.whowatchEventId);
        setStrategyTemplate(match ? matchEventTemplate(match.eventKey) : DEFAULT_EVENT_TEMPLATE);
      })
      .catch(() => {
        if (!cancelled) setStrategyTemplate(DEFAULT_EVENT_TEMPLATE);
      });
    return () => {
      cancelled = true;
    };
  }, [event.platform, event.whowatchEventId]);

  // R2: アイテムマスタ（既存 /api/platforms/whowatch/items を再利用・新規外部アクセス無し）
  const [strategyItems, setStrategyItems] = useState<ItemMasterEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/platforms/whowatch/items")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data: { items?: Array<{ id: string; name: string; basePoint: number; priceJpy?: number }> }) => {
        if (cancelled) return;
        setStrategyItems(
          (data.items ?? []).map((i) => ({
            itemId: i.id,
            name: i.name,
            basePoint: i.basePoint,
            priceJpy: i.priceJpy ?? 0,
          }))
        );
      })
      .catch(() => {
        if (!cancelled) setStrategyItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const strategy = useEventStrategy(event, strategyItems, strategyTemplate);
  const sparklinePalette = useCssTokens(SPARKLINE_TOKENS);

  const [pastHistory, setPastHistory] = useState<PastHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // E1b: 区分・ランキング種別・期間の編集（ふわっち連携イベントのみ）
  const [editingSettings, setEditingSettings] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // score型は自動取得経路が無いため手動入力（R4c）。manualScore===nullは「未入力」を表す。
  const [editingScore, setEditingScore] = useState(false);
  const [scoreInput, setScoreInput] = useState("");
  const [savingScore, setSavingScore] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);

  const handleSaveScore = async () => {
    const parsed = Number(scoreInput);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setScoreError("0以上の数値を入力してください");
      return;
    }
    setSavingScore(true);
    setScoreError(null);
    try {
      const res = await fetch(`/api/events/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score: Math.round(parsed) }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null;
        setScoreError(d?.error ?? "保存に失敗しました");
        setSavingScore(false);
        return;
      }
      setScoreInput("");
      setEditingScore(false);
    } catch {
      setScoreError("通信エラーが発生しました");
    } finally {
      setSavingScore(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/events/${event.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null;
        setDeleteError(d?.error ?? "削除に失敗しました");
        setDeleting(false);
        return;
      }
      onDeleted?.();
    } catch {
      setDeleteError("通信エラーが発生しました");
      setDeleting(false);
    }
  };

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      try {
        const { data } = await supabase
          .from("event_history")
          .select("name, final_score, final_rank, achieved, event_type, start_time")
          .eq("platform", event.platform)
          .order("created_at", { ascending: false })
          .limit(5);
        setPastHistory((data ?? []) as PastHistoryRow[]);
      } catch {
        setPastHistory([]);
      } finally {
        setHistoryLoading(false);
      }
    })();
  }, [event.id, event.platform]);

  const isRankingType =
    event.eventType === "ranking" ||
    event.eventType === "nice" ||
    event.eventType === "viewer";

  // 入賞確率の時系列 (ranking 型 / paceHistory 3 点以上 / 最大 20 サンプル)
  const probabilityHistory = useMemo(() => {
    if (!isRankingType || !event.targetRank || event.paceHistory.length < 3) return [];

    const fullHistory = event.paceHistory.map((p) => ({
      timestamp: new Date(p.timestamp),
      score: p.score,
    }));

    const step = Math.max(1, Math.floor(fullHistory.length / 20));
    const sampled = fullHistory.filter((_, i) => i % step === 0);

    const rivals = (event.rivalsSnapshot?.rivals ?? []).map((r) => ({
      name: r.name,
      currentScore: r.score,
      paceMean: 0,
      paceStdDev: 100,
    }));

    return sampled.map((point) => {
      const partialHistory = fullHistory.filter((h) => h.timestamp <= point.timestamp);
      const { mean, stdDev } = estimatePaceParameters(partialHistory);
      const remainingHours = Math.max(
        0,
        (new Date(event.endTime).getTime() - point.timestamp.getTime()) / 3_600_000
      );
      const result = simulateRankingProbability({
        myCurrentScore: point.score,
        myPaceMean: mean,
        myPaceStdDev: stdDev,
        rivals,
        remainingHours,
        targetRank: event.targetRank!,
        iterations: 500,
      });
      return { timestamp: point.timestamp, probability: result.rankProbability };
    });
  }, [
    isRankingType,
    event.targetRank,
    event.paceHistory,
    event.rivalsSnapshot,
    event.endTime,
  ]);

  const autoRivals = (event.rivalsSnapshot?.rivals ?? []).map((r) => ({
    rank: r.rank,
    name: r.name,
    score: r.score,
  }));

  const historyPanel = (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="mb-2 text-xs text-muted-foreground">
        過去の成績（
        {event.platform === "whowatch"
          ? "ふわっち"
          : event.platform === "niconico"
          ? "ニコ生"
          : event.platform}{" "}
        直近 5 件）
      </p>
      {historyLoading ? (
        <div className="h-10 animate-pulse rounded bg-muted" />
      ) : pastHistory.length === 0 ? (
        <p className="text-xs text-muted-foreground">過去データなし</p>
      ) : (
        <div className="space-y-1.5">
          {pastHistory.map((h, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="max-w-[140px] truncate text-muted-foreground">{h.name}</span>
              <div className="flex shrink-0 items-center gap-2">
                {h.final_rank !== null && (
                  <span className="text-foreground">{h.final_rank} 位</span>
                )}
                {h.final_score !== null && (
                  <span className="text-muted-foreground">
                    {h.final_score.toLocaleString()} pt
                  </span>
                )}
                <span
                  className={
                    h.achieved
                      ? "text-status-success"
                      : "text-muted-foreground"
                  }
                >
                  {h.achieved ? "達成" : "未達"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* ヒーロー: ヘッダー + 主要数字（達成確率/達成率）は常時表示 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-bold text-foreground">{event.name}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {event.platform} ·{" "}
              {event.eventType === "score"
                ? "スコア目標"
                : event.eventType === "ranking"
                ? "ランキング目標"
                : event.eventType === "nice"
                ? "ナイス目標"
                : "視聴者数目標"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {forecast && (
              <span
                className={`rounded-full border border-current px-2 py-1 text-xs font-bold ${STATUS_COLORS[forecast.status]}`}
              >
                {STATUS_LABELS[forecast.status]}
              </span>
            )}
            <button
              type="button"
              onClick={() => setConfirmingDelete((v) => !v)}
              aria-label="イベントを削除"
              aria-expanded={confirmingDelete}
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        </div>

        {confirmingDelete && (
          <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
            <p className="text-sm text-foreground">
              「{event.name}」を削除しますか？取り消せません。
            </p>
            {deleteError && <p className="mt-1 text-xs text-destructive">{deleteError}</p>}
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="min-h-11 flex-1 rounded-full bg-destructive px-3 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
              >
                {deleting ? "削除中..." : "削除する"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingDelete(false);
                  setDeleteError(null);
                }}
                disabled={deleting}
                className="min-h-11 rounded-full bg-muted px-4 text-sm text-foreground disabled:opacity-50"
              >
                キャンセル
              </button>
            </div>
          </div>
        )}

        {event.platform === "whowatch" && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {event.rankingType && <span className="rounded-full bg-muted px-2 py-0.5">ranking_type: {event.rankingType}</span>}
            <span>
              {new Date(event.startTime).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              {" 〜 "}
              {new Date(event.endTime).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
            {!editingSettings && (
              <button
                type="button"
                onClick={() => setEditingSettings(true)}
                className="min-h-8 rounded-full border border-border bg-muted px-3 text-xs text-foreground"
              >
                区分・期間を編集
              </button>
            )}
          </div>
        )}

        {forecast && <p className="mt-2 text-xs text-foreground">{forecast.message}</p>}
        {historicalPace.hasSufficientData && (
          <p className="mt-1 text-xs text-muted-foreground">
            📊 過去データ参照中 ({historicalPace.sampleCount}件)
          </p>
        )}

        {forecast && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>残り {formatTime(forecast.remainingMinutes)}</span>
            <span>経過 {formatTime(forecast.elapsedMinutes)}</span>
            <span>現在ペース {Math.round(forecast.currentHourlyPace).toLocaleString()}/時</span>
          </div>
        )}
      </div>

      {editingSettings && (
        <EventSettingsEditor
          eventId={event.id}
          whowatchEventId={event.whowatchEventId}
          currentRankingType={event.rankingType}
          currentStartTime={event.startTime}
          currentEndTime={event.endTime}
          onSaved={() => setEditingSettings(false)}
          onCancel={() => setEditingSettings(false)}
        />
      )}

      {/* score 型: 自動取得経路が無いため manualScore===null は「未入力」として進捗を捏造せずゲートする */}
      {!isRankingType && event.manualScore === null && !editingScore && (
        <div className="space-y-2 rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-foreground">現在スコア未入力</p>
          <p className="text-xs text-muted-foreground">
            score型イベントは自動取得できません。現在のスコアを手動で入力してください。
          </p>
          <button
            type="button"
            onClick={() => setEditingScore(true)}
            className="min-h-11 w-full rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            スコアを入力
          </button>
        </div>
      )}

      {!isRankingType && editingScore && (
        <div className="space-y-2 rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-foreground">現在スコアを入力</p>
          <div className="flex gap-2">
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={scoreInput}
              onChange={(e) => setScoreInput(e.target.value)}
              placeholder="例：12000"
              className="min-h-11 flex-1 rounded-sm border border-border bg-background px-3 text-sm text-foreground"
            />
            <button
              type="button"
              onClick={() => void handleSaveScore()}
              disabled={savingScore || scoreInput === ""}
              className="min-h-11 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {savingScore ? "保存中..." : "保存"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingScore(false);
                setScoreError(null);
              }}
              disabled={savingScore}
              className="min-h-11 rounded-full bg-muted px-4 text-sm text-foreground disabled:opacity-50"
            >
              キャンセル
            </button>
          </div>
          {scoreError && <p className="text-xs text-destructive">{scoreError}</p>}
        </div>
      )}

      {!isRankingType && event.manualScore !== null && !editingScore && forecast && (
        <div className="space-y-2 rounded-xl border border-border bg-card p-4">
          <div className="flex justify-between text-xs text-foreground">
            <span>達成率</span>
            <span>{forecast.progressPercent.toFixed(1)}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${Math.min(100, forecast.progressPercent)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>現在 {event.currentScore.toLocaleString()}</span>
            <span>目標 {(event.targetScore ?? 0).toLocaleString()}</span>
          </div>
          {forecast.remainingScore !== undefined && (
            <div className="text-xs text-muted-foreground">
              残り {forecast.remainingScore.toLocaleString()} ·{" "}
              必要ペース {Math.round(forecast.requiredHourlyPace ?? 0).toLocaleString()}/時
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              setScoreInput(String(event.currentScore));
              setEditingScore(true);
            }}
            className="text-xs text-primary hover:underline"
          >
            スコアを更新
          </button>
        </div>
      )}

      {/* ranking 型の確率表示 */}
      {isRankingType && forecast && (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div>
            <div className="mb-1 flex justify-between text-xs text-foreground">
              <span>目標 {event.targetRank} 位以内の確率</span>
              <span className="text-sm font-bold">
                {(forecast.rankProbability ?? 0).toFixed(1)}%
              </span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  (forecast.rankProbability ?? 0) >= 60
                    ? "bg-status-success"
                    : (forecast.rankProbability ?? 0) >= 25
                    ? "bg-status-warning"
                    : "bg-destructive"
                }`}
                style={{ width: `${Math.min(100, forecast.rankProbability ?? 0)}%` }}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>期待順位 {(forecast.expectedRank ?? 0).toFixed(1)} 位</span>
            {forecast.myFinalScorePercentiles && (
              <span>
                最終スコア中央値{" "}
                {forecast.myFinalScorePercentiles.p50.toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}
              </span>
            )}
          </div>

          <div className="text-xs text-muted-foreground">
            現在スコア {event.currentScore.toLocaleString()}
            {event.currentRank && ` · 現在 ${event.currentRank} 位`}
          </div>
          {event.currentRank === null && event.rivalsSnapshot !== null && (
            <p className="text-xs text-status-warning">
              自分の順位を特定できません（エントリ名を確認）(要確認)
            </p>
          )}
        </div>
      )}

      {/* E3: ranking_snapshots からの逆算と確率（ふわっち連携・ranking_type あり） */}
      {isRankingType && event.platform === "whowatch" && event.rankingType && (
        <RankForecastPanel
          eventId={event.id}
          whowatchEventId={event.whowatchEventId}
          targetRank={event.targetRank ?? 5}
          endTime={event.endTime}
        />
      )}

      {/* 攻略（R1型テンプレ要約 + R2/R3最適アイテム提案）: 1画面1目的・期待値/目安のみで断定しない */}
      {SHOW_STRATEGY_PANEL && strategy && (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-foreground">攻略</h4>
            {!strategyTemplate.ceoConfirmedAt && (
              <span className="rounded-full bg-status-warning/10 px-2 py-0.5 text-xs text-status-warning">
                (要確認)
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{strategyTemplate.label}</span>
            <span className="ml-1">単位: {strategyTemplate.unit}</span>
          </div>
          <p className="text-xs text-muted-foreground">{strategyTemplate.ruleSummary}</p>

          {strategy.reverseTarget.kind === "insufficient_data" ? (
            <p className="text-xs text-muted-foreground">{strategy.reverseTarget.reason}</p>
          ) : (
            <>
              <div className="text-xs text-foreground">
                必要な追加{strategyTemplate.unit}（目安）: 約
                {strategy.reverseTarget.requiredAdditionalPt.p50.toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}
                〜
                {strategy.reverseTarget.requiredAdditionalPt.p90.toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}
                {strategyTemplate.unit}
              </div>
              <p className="text-xs text-muted-foreground">{strategy.reverseTarget.disclaimer}</p>

              {strategy.itemPlan.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-foreground">おすすめアイテム（効率順・目安）</p>
                  {strategy.itemPlan.map((plan) => (
                    <div
                      key={plan.itemId}
                      className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-xs"
                    >
                      <span className="text-foreground">{plan.name}</span>
                      <span className="text-muted-foreground">{plan.note}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* 詳細: ranking 型のみ「概要／ライバル／履歴」をタブ分割。score 型は履歴のみ直接表示 */}
      {isRankingType ? (
        <Tabs defaultValue="overview">
          <TabsList className="w-full">
            <TabsTrigger value="overview" className="flex-1">
              概要
            </TabsTrigger>
            <TabsTrigger value="rivals" className="flex-1">
              ライバル
            </TabsTrigger>
            <TabsTrigger value="history" className="flex-1">
              履歴
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-3 space-y-3">
            {probabilityHistory.length >= 3 && (
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="mb-2 text-xs text-muted-foreground">
                  入賞確率の推移（目標 {event.targetRank} 位以内）
                </p>
                <svg
                  viewBox="0 0 100 40"
                  preserveAspectRatio="none"
                  className="h-10 w-full"
                  aria-hidden="true"
                >
                  {/* 60% 基準ライン */}
                  <line
                    x1="0"
                    y1={40 - (60 / 100) * 36}
                    x2="100"
                    y2={40 - (60 / 100) * 36}
                    stroke={sparklinePalette.baseline}
                    strokeWidth="1"
                    strokeDasharray="2,2"
                    vectorEffect="non-scaling-stroke"
                  />
                  <polyline
                    points={probabilityHistory
                      .map((p, i) => {
                        const x = ((i / (probabilityHistory.length - 1)) * 100).toFixed(1);
                        const y = (40 - (p.probability / 100) * 36).toFixed(1);
                        return `${x},${y}`;
                      })
                      .join(" ")}
                    fill="none"
                    stroke={sparklinePalette.line}
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                  <span>開始</span>
                  <span>── 60% ライン</span>
                  <span>現在</span>
                </div>
              </div>
            )}
            {forecast?.rankDistribution && event.targetRank && (
              <RankDistributionChart
                distribution={forecast.rankDistribution}
                targetRank={event.targetRank}
              />
            )}
          </TabsContent>

          <TabsContent value="rivals" className="mt-3">
            <RivalsList
              eventId={event.id}
              myEntryName={event.myEntryName}
              myCurrentRank={event.currentRank}
              myCurrentScore={event.currentScore}
              autoRivals={autoRivals}
              manualRivals={event.manualRivals ?? []}
              hasRankingUrl={Boolean(event.eventRankingUrl)}
              hasRankingType={Boolean(event.rankingType)}
              lastCapturedAt={event.rivalsSnapshot?.timestamp ?? null}
            />
          </TabsContent>

          <TabsContent value="history" className="mt-3">
            {historyPanel}
          </TabsContent>
        </Tabs>
      ) : (
        historyPanel
      )}
    </div>
  );
}
