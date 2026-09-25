"use client";

import { useState } from "react";

interface Rival {
  rank: number;
  name: string;
  score: number;
}

interface ManualRival {
  name: string;
  score: number;
}

interface Props {
  eventId: string;
  myEntryName?: string | null;
  myCurrentRank?: number | null;
  myCurrentScore: number;
  autoRivals: Rival[];
  manualRivals: ManualRival[];
  hasRankingUrl: boolean;
  /** E2: ranking_type が設定済み（公開 API で自動取得できる） */
  hasRankingType?: boolean;
  /** 最終取得時刻（rivalsSnapshot.timestamp） */
  lastCapturedAt?: string | null;
}

export function RivalsList({
  eventId,
  myEntryName,
  myCurrentRank,
  myCurrentScore,
  autoRivals,
  manualRivals,
  hasRankingUrl,
  hasRankingType = false,
  lastCapturedAt = null,
}: Props) {
  const canAutoFetch = hasRankingUrl || hasRankingType;
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const res = await fetch(`/api/events/${eventId}/refresh-ranking`, { method: "POST" });
      const d = await res.json() as { success: boolean; message?: string; source?: string; snapshotId?: string | null };
      if (!d.success) setRefreshMsg(d.message ?? "取得失敗");
      else setRefreshMsg(d.source === "api" ? "公開 API から取得・スナップショット保存済み" : "取得しました");
    } catch {
      setRefreshMsg("ネットワークエラー");
    } finally {
      setRefreshing(false);
    }
  };

  // 自動取得ライバルと手動入力ライバルをマージして rank 順に表示
  const displayRivals: Rival[] = [
    ...autoRivals,
    ...manualRivals.map((r, i) => ({ rank: 9000 + i, name: r.name, score: r.score })),
  ].sort((a, b) => a.rank - b.rank);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h4 className="text-sm font-bold text-foreground">ライバル状況</h4>
          {lastCapturedAt && (
            <p className="text-xs text-muted-foreground">最終取得 {new Date(lastCapturedAt).toLocaleString("ja-JP")}</p>
          )}
        </div>
        {canAutoFetch && (
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="min-h-11 rounded-full border border-border bg-muted px-3 text-xs text-foreground disabled:opacity-50"
          >
            {refreshing ? "取得中..." : "ランキング更新"}
          </button>
        )}
      </div>

      {refreshMsg && (
        <p className="mb-2 text-xs text-status-warning">{refreshMsg}</p>
      )}

      {displayRivals.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          ライバル情報がありません。
          {canAutoFetch
            ? "「ランキング更新」を押すか、手動で入力してください。"
            : "手動入力してください。"}
        </p>
      ) : (
        <div className="space-y-0.5">
          {displayRivals.map((rival, i) => (
            <div
              key={`${rival.name}-${i}`}
              className="flex items-center gap-2 border-b border-border py-1.5 text-xs last:border-0"
            >
              <span className="w-8 shrink-0 font-mono text-muted-foreground">
                {rival.rank >= 9000 ? "手動" : `${rival.rank}位`}
              </span>
              <span className="flex-1 truncate text-foreground">{rival.name}</span>
              <span className="shrink-0 font-mono text-foreground">
                {rival.score.toLocaleString()}
              </span>
            </div>
          ))}

          {myCurrentRank && (
            <div className="mt-1 flex items-center gap-2 rounded bg-primary/10 px-2 py-1.5 text-xs">
              <span className="w-8 shrink-0 font-mono text-primary">{myCurrentRank}位</span>
              <span className="flex-1 truncate text-primary">{myEntryName ?? "あなた"}</span>
              <span className="shrink-0 font-mono text-primary">
                {myCurrentScore.toLocaleString()}
              </span>
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => setShowManual((v) => !v)}
        className="mt-3 min-h-11 w-full rounded-full bg-muted text-xs text-muted-foreground hover:text-foreground"
      >
        {showManual ? "手動入力を閉じる" : "ライバル手動入力"}
      </button>

      {showManual && (
        <ManualRivalsForm
          eventId={eventId}
          initialRivals={manualRivals}
          onSaved={() => setShowManual(false)}
        />
      )}
    </div>
  );
}

function ManualRivalsForm({
  eventId,
  initialRivals,
  onSaved,
}: {
  eventId: string;
  initialRivals: ManualRival[];
  onSaved: () => void;
}) {
  const [rivals, setRivals] = useState<ManualRival[]>(
    initialRivals.length > 0 ? initialRivals : [{ name: "", score: 0 }]
  );
  const [saving, setSaving] = useState(false);

  const update = (index: number, key: keyof ManualRival, value: string) => {
    setRivals((prev) =>
      prev.map((r, i) =>
        i === index ? { ...r, [key]: key === "score" ? parseInt(value, 10) || 0 : value } : r
      )
    );
  };

  const addRow = () => setRivals((prev) => [...prev, { name: "", score: 0 }]);
  const removeRow = (index: number) => setRivals((prev) => prev.filter((_, i) => i !== index));

  const handleSave = async () => {
    setSaving(true);
    try {
      const valid = rivals.filter((r) => r.name.trim() !== "");
      await fetch(`/api/events/${eventId}/manual-rivals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rivals: valid }),
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 space-y-2">
      {rivals.map((rival, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={rival.name}
            onChange={(e) => update(i, "name", e.target.value)}
            placeholder="名前"
            className="min-h-11 flex-1 rounded-sm bg-muted px-2 py-1 text-xs text-foreground"
          />
          <input
            type="number"
            value={rival.score}
            onChange={(e) => update(i, "score", e.target.value)}
            placeholder="スコア"
            className="min-h-11 w-24 rounded-sm bg-muted px-2 py-1 text-xs text-foreground"
          />
          <button
            type="button"
            onClick={() => removeRow(i)}
            className="min-h-11 rounded-full px-2 text-xs text-muted-foreground hover:text-destructive"
          >
            削除
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={addRow}
          className="min-h-11 rounded-full px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          + 追加
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="ml-auto min-h-11 rounded-full bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
    </div>
  );
}
