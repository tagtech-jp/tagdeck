"use client";

import { useEffect, useState } from "react";
// 区分の絞り込みと既定（総合 → 先頭）は 5 分同期の自動設定と共通（2026-10-01）
import { choicesForOption, defaultChoice } from "@/lib/whowatch/ranking-choice";
// 期間限定アイテム型（limited-item・黄金発掘隊）: グループ（配信者グレード）は自動判定が既定。空で保存すると「自動判定に戻す」（2026-10-07）
import { isLimitedItemPrefix } from "@/lib/whowatch/limited-item";
// 期間が切り替わるランキング（limited-item のデイリー・WGP・N-1）の期間の入れ方と文言（2026-10-07）
import {
  defaultPeriodWindow,
  hasAutoDivision,
  isN1Prefix,
  periodButtonLabel,
  periodEndAfter,
  periodEndHint,
  periodicSchemeFor,
  periodMaxSpanMs,
  periodSchemeLabel,
  periodStartHint,
  type PeriodScheme,
} from "@/lib/whowatch/periodic-ranking";

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
  rankingPrefix?: string | null;
  /** daily = 毎日 0:00 区切り（期間限定アイテム型など）。期間の切り替えボタンに使う */
  kind?: "daily" | "long" | null;
  startedAt?: string | null;
  endTime?: string | null;
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
  // 期間の切り替え方: limited-item / WGP / N-1 は選んだ種別（空 = 自動判定なら家族の既定）から。それ以外は kind = daily（区分なし）なら日替わり
  const schemeFor = (d: Detail, type: string): PeriodScheme | null =>
    periodicSchemeFor(d.rankingPrefix, type) ?? (d.kind === "daily" && d.periods.length === 0 ? "daily" : null);
  const periodScheme = detail ? schemeFor(detail, rankingType) : null;
  const isDailyEvent = periodScheme !== null && periodScheme !== "whole";
  // 期間の入れ方（2026-10-07）: "day" = 1 期間ぶん（開始を変えると終了が期間の終わりに追従。日替わりなら開始日の翌日 0:00 JST）、"full" = イベント全期間。
  // 既定は今の期間の長さから（その切り替え方の 1 期間ぶん以下なら day）
  const [periodModeOverride, setPeriodModeOverride] = useState<"day" | "full" | null>(null);
  const currentSpanMs = new Date(currentEndTime).getTime() - new Date(currentStartTime).getTime();
  const periodMode: "day" | "full" = periodModeOverride ?? (currentSpanMs <= periodMaxSpanMs(periodScheme ?? "daily") ? "day" : "full");
  const applyWindow = (mode: "day" | "full", scheme: PeriodScheme | null = periodScheme) => {
    if (!detail) return;
    setPeriodModeOverride(mode);
    const start = detail.startedAt ? new Date(detail.startedAt) : null;
    const end = detail.endTime ? new Date(detail.endTime) : null;
    if (mode === "full") {
      if (start && !isNaN(start.getTime())) setStartTime(toLocal(start.toISOString()));
      if (end && !isNaN(end.getTime())) setEndTime(toLocal(end.toISOString()));
      return;
    }
    if (!scheme || scheme === "whole") return;
    const w = defaultPeriodWindow(scheme, new Date(), { start, end });
    setStartTime(toLocal(w.start.toISOString()));
    setEndTime(toLocal(w.end.toISOString()));
  };
  const handleStartChange = (value: string) => {
    setStartTime(value);
    if (!isDailyEvent || periodMode !== "day" || !periodScheme) return;
    const d = new Date(value);
    if (isNaN(d.getTime())) return;
    const end = periodEndAfter(periodScheme, d);
    if (end) setEndTime(toLocal(end.toISOString()));
  };
  // 種別を変えたとき（WGP: デイリー ⇄ 月間総合、N-1: 期間別 ⇄ 全期間）: 1 期間の入れ方なら期間をその種別の区切りに入れ直す
  const handleRankingTypeChange = (value: string) => {
    setRankingType(value);
    if (!detail || periodMode !== "day") return;
    const scheme = schemeFor(detail, value);
    if (scheme && scheme !== "whole") applyWindow("day", scheme);
  };
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
        // 期間限定アイテム型のグループと N-1 の部門は既定を置かない（空 = 自動判定）。それ以外は従来どおり「総合 → 先頭」
        if (!cur) setRankingType(hasAutoDivision(det.rankingPrefix) ? (currentRankingType ?? "") : defaultChoice(choicesForOption(det.rankingChoices, det.periods.length > 0 ? key : null))?.rankingType ?? "");
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
      // 期間限定アイテム型・N-1 で「自動判定」を選んだら区分を空に戻す（5 分同期が今の順位表からグループ / 部門を判定し直す）
      else if (detail && hasAutoDivision(detail.rankingPrefix) && currentRankingType) body.rankingType = null;
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
              <label className="mb-1 block text-xs text-muted-foreground">
                {isLimitedItemPrefix(detail.rankingPrefix) ? "グループ（配信者グレード）" : isN1Prefix(detail.rankingPrefix) ? "部門" : "ランキング種別"}
                {isDailyEvent && periodScheme && <span className="ml-1 text-primary">（{periodSchemeLabel(periodScheme)}）</span>}
              </label>
              <select
                value={rankingType}
                onChange={(e) => handleRankingTypeChange(e.target.value)}
                className="min-h-11 w-full rounded-sm bg-muted px-3 py-2 text-sm text-foreground"
              >
                {hasAutoDivision(detail.rankingPrefix) && (
                  <option value="">
                    {isN1Prefix(detail.rankingPrefix) ? "自動判定（ふわっちのプロフィールの性別と、今の回の順位表の本人の行から 5 分同期が設定。ルーキー対象ならルーキー部門）" : "自動判定（今日の順位表に載った時点で 5 分同期が設定）"}
                  </option>
                )}
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
            <p className="text-xs text-status-warning">
              {detail.rankingPrefix && detail.rankingChoices.length === 0
                ? "ランキング区分をまだ取得できていません（期間中は 5 分ごとの同期が取り直して自動で設定します）"
                : "このイベントにはランキング区分がありません"}
            </p>
          )}
        </>
      ) : null}

      {detail && isDailyEvent && periodScheme && (
        // 期間が切り替わるランキング: 期間を「今の 1 期間（今日 / 今の回 / 今月）」か「イベント全期間」にワンタップで入れる（2026-10-07）
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">期間（{periodSchemeLabel(periodScheme)}）:</span>
          <button
            type="button"
            onClick={() => applyWindow("day")}
            aria-pressed={periodMode === "day"}
            className={`min-h-8 rounded-full border px-3 ${periodMode === "day" ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted text-foreground"}`}
          >
            {periodButtonLabel(periodScheme)}
          </button>
          {periodScheme !== "monthly" && detail.startedAt && detail.endTime && (
            <button
              type="button"
              onClick={() => applyWindow("full")}
              aria-pressed={periodMode === "full"}
              className={`min-h-8 rounded-full border px-3 ${periodMode === "full" ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted text-foreground"}`}
            >
              イベント全期間（{new Date(detail.startedAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}〜
              {new Date(detail.endTime).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}）
            </button>
          )}
          {periodMode === "day" && <span className="text-muted-foreground">開始日時: {periodStartHint(periodScheme)} / 終了日時: {periodEndHint(periodScheme)}</span>}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">開始日時（手修正可）</label>
          <input
            type="datetime-local"
            value={startTime}
            onChange={(e) => handleStartChange(e.target.value)}
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
