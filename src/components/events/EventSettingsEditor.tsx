"use client";

import { useEffect, useState } from "react";

// E1b: 作成済みシミュレーターの区分（前半/後半）・ランキング種別・期間を後から変更する編集導線。
// 例: オータムグッズコレクションを「後半（2nd, 9/23 00:00〜9/28 00:00 JST, autumncollection_2nd_overall）」へ更新する。

interface RankingChoice {
  rankingType: string;
  label: string;
  parts: string[];
  border: Array<{ rank: number }>;
}
interface EventPeriod {
  option_key: string;
  label: string;
  starts_at: string;
  ends_at: string;
  source: "rules" | "estimated";
}
interface Detail {
  eventKey: string;
  name: string;
  rankingChoices: RankingChoice[];
  periods: EventPeriod[];
}
interface ListItem {
  id: number;
  eventKey: string;
  badgeText: string | null;
}

interface Props {
  eventId: string;
  whowatchEventId: number | null;
  currentRankingType: string | null;
  currentStartTime: string;
  currentEndTime: string;
  onSaved: () => void;
  onCancel: () => void;
}

function toLocal(iso: string): string {
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return "";
  return new Date(dt.getTime() - dt.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function choicesForOption(choices: RankingChoice[], optionKey: string | null): RankingChoice[] {
  return optionKey ? choices.filter((c) => c.parts[0] === optionKey) : choices;
}
function defaultChoice(choices: RankingChoice[]): RankingChoice | null {
  return choices.find((c) => c.parts.length === 2 && c.parts[1] === "overall") ?? choices[0] ?? null;
}
function stripOptionLabel(label: string): string {
  const i = label.indexOf(" › ");
  return i >= 0 ? label.slice(i + 3) : label;
}

export function EventSettingsEditor({ eventId, whowatchEventId, currentRankingType, currentStartTime, currentEndTime, onSaved, onCancel }: Props) {
  const [list, setList] = useState<ListItem[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  const [eventKey, setEventKey] = useState<string>("");
  // 取得済み詳細は eventKey と組で持ち、キーが変わったら派生的に null 扱いにする（effect 内の同期 setState を避ける）
  const [detailState, setDetailState] = useState<{ key: string; detail: Detail | null } | null>(null);
  const detail = detailState && detailState.key === eventKey ? detailState.detail : null;
  const detailFailed = Boolean(detailState && detailState.key === eventKey && detailState.detail === null);
  const loading = !listLoaded || (Boolean(eventKey) && !detail && !detailFailed);
  const [periodKey, setPeriodKey] = useState<string | null>(null);
  const [rankingType, setRankingType] = useState<string>(currentRankingType ?? "");
  const [startTime, setStartTime] = useState(() => toLocal(currentStartTime));
  const [endTime, setEndTime] = useState(() => toLocal(currentEndTime));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // whowatchEventId → event_key（open/pre 一覧から解決）。見つからなければユーザーに選んでもらう
  useEffect(() => {
    let cancelled = false;
    fetch("/api/platforms/whowatch/events/list")
      .then((r) => (r.ok ? (r.json() as Promise<{ open?: ListItem[]; pre?: ListItem[] }>) : { open: [], pre: [] }))
      .then((d: { open?: ListItem[]; pre?: ListItem[] }) => {
        if (cancelled) return;
        const all = [...(d.open ?? []), ...(d.pre ?? [])];
        setList(all);
        const hit = all.find((e) => e.id === whowatchEventId);
        if (hit) setEventKey(hit.eventKey);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setListLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [whowatchEventId]);

  useEffect(() => {
    if (!eventKey) return;
    let cancelled = false;
    fetch(`/api/platforms/whowatch/events/${encodeURIComponent(eventKey)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Detail | null>) : null))
      .then((d: Detail | null) => {
        if (cancelled) return;
        if (!d) {
          setDetailState({ key: eventKey, detail: null });
          return;
        }
        const det: Detail = { ...d, periods: d.periods ?? [], rankingChoices: d.rankingChoices ?? [] };
        setDetailState({ key: eventKey, detail: det });
        // 現在の ranking_type から区分を推定（例 autumncollection_2nd_overall → 2nd）
        const cur = det.rankingChoices.find((c) => c.rankingType === currentRankingType);
        const key = cur?.parts[0] ?? det.periods[0]?.option_key ?? null;
        setPeriodKey(det.periods.length > 0 ? key : null);
        if (!cur) setRankingType(defaultChoice(choicesForOption(det.rankingChoices, det.periods.length > 0 ? key : null))?.rankingType ?? "");
      })
      .catch(() => {
        if (!cancelled) setDetailState({ key: eventKey, detail: null });
      });
    return () => {
      cancelled = true;
    };
  }, [eventKey, currentRankingType]);

  const applyPeriod = (key: string) => {
    if (!detail) return;
    setPeriodKey(key);
    const p = detail.periods.find((x) => x.option_key === key);
    if (p) {
      setStartTime(toLocal(p.starts_at));
      setEndTime(toLocal(p.ends_at));
    }
    setRankingType(defaultChoice(choicesForOption(detail.rankingChoices, key))?.rankingType ?? "");
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (rankingType) body.rankingType = rankingType;
      if (startTime) body.startTime = new Date(startTime).toISOString();
      if (endTime) body.endTime = new Date(endTime).toISOString();
      const res = await fetch(`/api/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(d?.error ?? "保存に失敗しました");
        return;
      }
      onSaved();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setSaving(false);
    }
  };

  const choices = detail ? choicesForOption(detail.rankingChoices, detail.periods.length > 0 ? periodKey : null) : [];

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <h4 className="text-sm font-bold text-foreground">イベント設定を編集</h4>

      {!eventKey && !loading && (
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">ふわっちイベント（紐付けを選択）</label>
          <select
            value={eventKey}
            onChange={(e) => setEventKey(e.target.value)}
            className="min-h-11 w-full rounded-sm bg-muted px-3 py-2 text-sm text-foreground"
          >
            <option value="">選択してください</option>
            {list.map((e) => (
              <option key={e.id} value={e.eventKey}>
                {e.eventKey}
                {e.badgeText ? `（${e.badgeText}）` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <div className="min-h-11 w-full animate-pulse rounded-sm bg-muted" />
      ) : detail ? (
        <>
          {detail.periods.length > 0 && (
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">区分（期間を自動設定）</label>
              <select
                value={periodKey ?? ""}
                onChange={(e) => applyPeriod(e.target.value)}
                className="min-h-11 w-full rounded-sm bg-muted px-3 py-2 text-sm text-foreground"
              >
                {detail.periods.map((p) => (
                  <option key={p.option_key} value={p.option_key}>
                    {p.label}
                    {p.source === "estimated" ? "（推定）" : ""}{" "}
                    {new Date(p.starts_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    {" 〜 "}
                    {new Date(p.ends_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </option>
                ))}
              </select>
            </div>
          )}
          {choices.length > 0 ? (
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">ランキング種別</label>
              <select
                value={rankingType}
                onChange={(e) => setRankingType(e.target.value)}
                className="min-h-11 w-full rounded-sm bg-muted px-3 py-2 text-sm text-foreground"
              >
                {choices.map((c) => (
                  <option key={c.rankingType} value={c.rankingType}>
                    {detail.periods.length > 0 ? stripOptionLabel(c.label) : c.label}
                    {c.border.length > 0 ? `（入賞 ${c.border.map((b) => b.rank).join("/")} 位）` : ""}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">ranking_type: {rankingType}</p>
            </div>
          ) : (
            <p className="text-xs text-status-warning">このイベントにはランキング区分がありません</p>
          )}
        </>
      ) : null}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">開始日時（手修正可）</label>
          <input
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="min-h-11 w-full rounded-sm bg-muted px-3 py-2 text-sm text-foreground"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">終了日時（手修正可）</label>
          <input
            type="datetime-local"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="min-h-11 w-full rounded-sm bg-muted px-3 py-2 text-sm text-foreground"
          />
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || (!rankingType && !startTime && !endTime)}
          className="min-h-11 flex-1 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="min-h-11 rounded-full bg-muted px-4 text-sm text-foreground disabled:opacity-50"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}
