"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

type EventType = "score" | "ranking" | "nice" | "viewer";

interface WhowatchEventRow {
  id: number;
  eventKey: string;
  bannerUrl: string;
  badgeText: string | null;
  startedAt: string | null;
  endedAt: string | null;
  status: string;
  displayName: string; // events route が付与（手動辞書→整形event_key）
}

type GoalMode = "rank" | "score";

// E1: /api/platforms/whowatch/events/{event_key} の応答（必要分のみ）
interface RankingChoice {
  rankingType: string;
  label: string;
  parts: string[];
  border: Array<{ rank: number }>;
}
// E1b: 区分（前半/後半・グループ）ごとの期間。ends_at は「24:00」を翌日 00:00 JST に正規化済み
interface EventPeriod {
  option_key: string;
  label: string;
  starts_at: string;
  ends_at: string;
  source: "rules" | "estimated";
}
interface WhowatchEventDetail {
  name: string;
  kind: "daily" | "long" | null;
  endTime: string | null; // ended_at + 1 秒（翌日 00:00:00 JST）
  rankingPrefix: string | null;
  rankingChoices: RankingChoice[];
  periods: EventPeriod[];
}

/** 区分（option_key）に属する選択肢。既定は「総合」(selectbox=overall・末端) → 無ければ先頭 */
function choicesForOption(choices: RankingChoice[], optionKey: string | null): RankingChoice[] {
  if (!optionKey) return choices;
  return choices.filter((c) => c.parts[0] === optionKey);
}
function defaultChoice(choices: RankingChoice[]): RankingChoice | null {
  return choices.find((c) => c.parts.length === 2 && c.parts[1] === "overall") ?? choices[0] ?? null;
}
function stripOptionLabel(label: string): string {
  const i = label.indexOf(" › ");
  return i >= 0 ? label.slice(i + 3) : label;
}

interface Props {
  onCreated: () => void;
  onCancel: () => void;
}

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  score: "スコア目標",
  ranking: "ランキング目標",
  nice: "ナイス目標",
  viewer: "視聴者数目標",
};

function toLocalDatetimeValue(isoString: string | null): string {
  if (!isoString) return "";
  const dt = new Date(isoString);
  if (isNaN(dt.getTime())) return "";
  return new Date(dt.getTime() - dt.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function nowAsLocalDatetimeValue(offsetMs = 0): string {
  const now = new Date();
  return new Date(now.getTime() + offsetMs - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function EventCreateForm({ onCreated, onCancel }: Props) {
  const [platform, setPlatform] = useState("whowatch");
  // E4: 表示は ranking 固定（score/nice/viewer の入力は非表示。既存データは壊さない）
  const [eventType, setEventType] = useState<EventType>("ranking");
  const [goalMode] = useState<GoalMode>("rank");
  const [targetRank, setTargetRank] = useState<number>(5);
  const [eventName, setEventName] = useState("");
  const [startTime, setStartTime] = useState(() => nowAsLocalDatetimeValue());
  const [endTime, setEndTime] = useState(() => nowAsLocalDatetimeValue(3_600_000));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [whowatchEvents, setWhowatchEvents] = useState<WhowatchEventRow[]>([]);
  const [whowatchLoading, setWhowatchLoading] = useState(true); // platform starts as "whowatch"
  const [selectedWhowatchEventId, setSelectedWhowatchEventId] = useState<number | null>(null);
  // E1: 区分（前半/後半・グループ・チップ）→ ranking_type
  const [eventDetail, setEventDetail] = useState<WhowatchEventDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rankingType, setRankingType] = useState<string>("");
  // E1b: 選択中の区分（periods がある時のみ）
  const [periodKey, setPeriodKey] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const applyPeriod = (d: WhowatchEventDetail, key: string | null) => {
    setPeriodKey(key);
    const period = key ? d.periods.find((p) => p.option_key === key) ?? null : null;
    if (period) {
      setStartTime(toLocalDatetimeValue(period.starts_at));
      setEndTime(toLocalDatetimeValue(period.ends_at));
    }
    const dc = defaultChoice(choicesForOption(d.rankingChoices, key));
    setRankingType(dc?.rankingType ?? "");
  };

  const selectedWhowatchEvent =
    platform === "whowatch"
      ? whowatchEvents.find((e) => e.id === selectedWhowatchEventId) ?? null
      : null;
  // E1b: 区分から自動設定した日時も手修正できるよう、入力欄は常に表示し「自動設定」ラベルだけ付ける
  const autoStartAvailable = false;
  const autoEndAvailable = false;
  const autoPeriodApplied = Boolean(periodKey);

  useEffect(() => {
    if (platform !== "whowatch") return;
    // events route は「開催中(open)のみ」を返す（R2）
    fetch("/api/platforms/whowatch/events")
      .then((r) => (r.ok ? r.json() : { open: [] }))
      .then((data: { open?: WhowatchEventRow[] }) => {
        setWhowatchEvents(data.open ?? []);
      })
      .catch(() => setWhowatchEvents([]))
      .finally(() => setWhowatchLoading(false));
  }, [platform]);

  const handleWhowatchSelect = (idStr: string) => {
    const id = parseInt(idStr, 10);
    if (isNaN(id)) {
      setSelectedWhowatchEventId(null);
      setEventName("");
      return;
    }
    const ev = whowatchEvents.find((e) => e.id === id);
    if (!ev) return;
    setSelectedWhowatchEventId(id);
    setEventName(ev.displayName); // 日本語名（フォールバック済み）
    const autoStart = toLocalDatetimeValue(ev.startedAt);
    if (autoStart) setStartTime(autoStart);
    // イベント終了 = ended_at(23:59:59 JST) + 1 秒 = 翌日 00:00:00 JST
    const autoEnd = ev.endedAt ? toLocalDatetimeValue(new Date(new Date(ev.endedAt).getTime() + 1000).toISOString()) : "";
    if (autoEnd) setEndTime(autoEnd);

    // E1: 詳細（正式名・区分・ランキング構造）を取得して自動入力。E1b: 区分ごとの期間があれば区分プルダウンで期間を決める
    setEventDetail(null);
    setRankingType("");
    setPeriodKey(null);
    setDetailError(null);
    setDetailLoading(true);
    fetch(`/api/platforms/whowatch/events/${encodeURIComponent(ev.eventKey)}`)
      .then(async (r) => {
        if (r.ok) return (await r.json()) as WhowatchEventDetail;
        const e = (await r.json().catch(() => null)) as { error?: string } | null;
        setDetailError(e?.error ?? `イベント詳細の取得に失敗しました (HTTP ${r.status})`);
        return null;
      })
      .then((d: WhowatchEventDetail | null) => {
        if (!d) return;
        const detail: WhowatchEventDetail = { ...d, periods: d.periods ?? [], rankingChoices: d.rankingChoices ?? [] };
        setEventDetail(detail);
        if (detail.name) setEventName(detail.name);
        if (detail.endTime) setEndTime(toLocalDatetimeValue(detail.endTime));
        if (detail.rankingChoices.length > 0) setEventType("ranking");
        if (detail.periods.length > 0) {
          // 現在時刻を含む区分 → 無ければ未来で最初の区分 → 無ければ先頭
          const nowMs = Date.now();
          const current = detail.periods.find((p) => new Date(p.starts_at).getTime() <= nowMs && nowMs < new Date(p.ends_at).getTime());
          const upcoming = detail.periods.find((p) => new Date(p.starts_at).getTime() > nowMs);
          applyPeriod(detail, (current ?? upcoming ?? detail.periods[0]).option_key);
        } else {
          applyPeriod(detail, null);
        }
      })
      .catch(() => {
        setEventDetail(null);
        setDetailError("イベント詳細の取得に失敗しました（通信エラー）");
      })
      .finally(() => setDetailLoading(false));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    // ふわっちで開催中イベントがある場合は選択必須（R3: カードピッカーのみ）
    if (platform === "whowatch" && whowatchEvents.length > 0 && !selectedWhowatchEventId) {
      setError("開催中のイベントを選択してください");
      return;
    }

    if (!eventName.trim()) {
      setError("イベント名を入力してください");
      return;
    }

    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      name: eventName.trim(),
      platform,
      eventType,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      whowatchEventId: selectedWhowatchEventId,
    };
    if (platform === "whowatch" && selectedWhowatchEvent && rankingType) {
      body.rankingType = rankingType;
    }

    if (eventType === "score") {
      const v = parseInt(fd.get("targetScore") as string, 10);
      if (isNaN(v)) { setError("目標スコアを入力してください"); setSubmitting(false); return; }
      body.targetScore = v;
    } else {
      // E4: 目標順位は 1〜5 のプルダウン
      if (goalMode === "rank") {
        body.targetRank = targetRank;
      } else {
        const v = parseInt(fd.get("targetScoreForRanking") as string, 10);
        if (isNaN(v)) { setError("目標スコアを入力してください"); setSubmitting(false); return; }
        body.targetScore = v;
      }
      const url = (fd.get("eventRankingUrl") as string).trim();
      if (url) body.eventRankingUrl = url;
      else if (platform === "whowatch" && selectedWhowatchEvent) {
        // 未入力なら公式イベントページを自動設定（E2 以降は ranking_type の API 取得を優先し、URL はフォールバック）
        body.eventRankingUrl = `https://whowatch.tv/events/${selectedWhowatchEvent.eventKey}`;
      }
      const name = (fd.get("myEntryName") as string).trim();
      if (name) body.myEntryName = name;
    }

    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: unknown };
        setError(JSON.stringify(d.error));
        return;
      }
      onCreated();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-border bg-card p-4">
      <h3 className="font-bold text-foreground">新規イベント作成</h3>

      {/* プラットフォーム */}
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">プラットフォーム</label>
        <select
          value={platform}
          onChange={(e) => {
            const p = e.target.value;
            setPlatform(p);
            setEventName("");
            setSelectedWhowatchEventId(null);
            if (p === "whowatch") setWhowatchLoading(true);
            else setWhowatchEvents([]);
          }}
          className="min-h-11 w-full rounded-sm bg-muted px-3 py-2 text-sm text-foreground"
        >
          <option value="whowatch">ふわっち</option>
          <option value="niconico">ニコ生</option>
          <option value="manual">手動</option>
        </select>
      </div>

      {/* 開催中のふわっちイベント選択: 公式バナー画像のカードピッカー（必須） */}
      {platform === "whowatch" && (
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            開催中のふわっちイベント（必須・タップで選択）
          </label>
          {whowatchLoading ? (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-24 w-40 shrink-0 animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          ) : whowatchEvents.length === 0 ? (
            <p className="px-1 text-xs text-status-warning">
              開催中のイベントがありません — 下でイベント名を手動入力してください
            </p>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {whowatchEvents.map((ev) => {
                const isSelected = selectedWhowatchEventId === ev.id;
                return (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => handleWhowatchSelect(String(ev.id))}
                    aria-pressed={isSelected}
                    className={`relative h-24 w-40 shrink-0 overflow-hidden rounded-xl border-2 text-left transition-colors ${
                      isSelected ? "border-primary" : "border-transparent"
                    }`}
                  >
                    {ev.bannerUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={ev.bannerUrl}
                        alt={ev.displayName}
                        className="absolute inset-0 size-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-muted" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                    <div className="absolute inset-x-0 bottom-0 p-2">
                      <div className="truncate text-xs font-semibold text-white">
                        {ev.displayName}
                      </div>
                      {ev.badgeText && ev.badgeText !== ev.displayName && (
                        <div className="truncate text-xs text-white/80">{ev.badgeText}</div>
                      )}
                    </div>
                    {isSelected && (
                      <div className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="size-3" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* イベント名: ふわっちで開催中イベントがある時はカードピッカーで確定（手動入力欄なし・R3）。
          それ以外（ニコ生/手動/ふわっちで開催中0件）は手動入力 */}
      {platform === "whowatch" && !whowatchLoading && whowatchEvents.length > 0 ? (
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">イベント名（選択済み）</label>
          <div className="w-full rounded-sm bg-muted px-3 py-2 text-sm text-foreground">
            {eventName || "上のカードからイベントを選択してください"}
          </div>
        </div>
      ) : (
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            イベント名
            {platform === "whowatch" && (
              <span className="ml-1 text-status-warning">
                （開催中イベント未取得のため手動入力）
              </span>
            )}
          </label>
          <input
            name="name"
            maxLength={100}
            placeholder="例：マンスリーイベント 5 月"
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            className="min-h-11 w-full rounded-sm bg-muted px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      )}

      {/* E1/E1b: 区分（前半/後半・グループ）→ 期間を自動入力、ランキング種別 → ranking_type を確定 */}
      {platform === "whowatch" && selectedWhowatchEvent && (
        <div className="space-y-3">
          {detailError && <p className="px-1 text-xs text-status-warning">{detailError}（区分は選べません。期間・ランキング URL を手入力してください）</p>}
          {detailLoading ? (
            <div className="min-h-11 w-full animate-pulse rounded-sm bg-muted" />
          ) : eventDetail && eventDetail.periods.length > 0 ? (
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                区分（期間を自動設定）
                {eventDetail.kind === "long" && <span className="ml-1 text-primary">（期間イベント）</span>}
              </label>
              <select
                value={periodKey ?? ""}
                onChange={(e) => applyPeriod(eventDetail, e.target.value || null)}
                className="min-h-11 w-full rounded-sm bg-muted px-3 py-2 text-sm text-foreground"
              >
                {eventDetail.periods.map((p) => (
                  <option key={p.option_key} value={p.option_key}>
                    {p.label}
                    {p.source === "estimated" ? "（推定）" : ""}{" "}
                    {new Date(p.starts_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    {" 〜 "}
                    {new Date(p.ends_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </option>
                ))}
              </select>
              {eventDetail.periods.find((p) => p.option_key === periodKey)?.source === "estimated" && (
                <p className="mt-1 text-xs text-status-warning">
                  本文から期間を読み取れなかったため、全体期間を等分した推定値です。下の日時を手修正してください
                </p>
              )}
            </div>
          ) : null}

          {!detailLoading && eventDetail && (
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                ランキング種別
                {eventDetail.periods.length === 0 && eventDetail.kind === "daily" && <span className="ml-1 text-primary">（デイリー）</span>}
              </label>
              {(() => {
                const list = choicesForOption(eventDetail.rankingChoices, eventDetail.periods.length > 0 ? periodKey : null);
                if (list.length === 0) {
                  return (
                    <p className="px-1 text-xs text-status-warning">
                      このイベントにはランキング区分がありません（ランキング自動取得は使えません）
                    </p>
                  );
                }
                return (
                  <>
                    <select
                      value={rankingType}
                      onChange={(e) => setRankingType(e.target.value)}
                      className="min-h-11 w-full rounded-sm bg-muted px-3 py-2 text-sm text-foreground"
                    >
                      {list.map((c) => (
                        <option key={c.rankingType} value={c.rankingType}>
                          {eventDetail.periods.length > 0 ? stripOptionLabel(c.label) : c.label}
                          {c.border.length > 0 ? `（入賞 ${c.border.map((b) => b.rank).join("/")} 位）` : ""}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-muted-foreground">ranking_type: {rankingType}</p>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* E4: イベントタイプは「ランキング目標」固定表示（score/nice/viewer は非表示） */}
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">イベントタイプ</label>
        <div className="min-h-11 w-full content-center rounded-sm bg-muted px-3 py-2 text-sm text-foreground">
          {EVENT_TYPE_LABELS[eventType]}
        </div>
      </div>

      {/* タイプ別フィールド */}
      {eventType === "score" ? (
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">目標スコア</label>
          <input
            name="targetScore"
            type="number"
            min={1}
            placeholder="例：100000"
            className="min-h-11 w-full rounded-sm bg-muted px-3 py-2 text-sm text-foreground"
          />
        </div>
      ) : (
        <>
          {/* E4: 目標順位 1〜5 のプルダウン */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">目標順位</label>
            <select
              value={targetRank}
              onChange={(e) => setTargetRank(Number(e.target.value))}
              className="min-h-11 w-full rounded-sm bg-muted px-3 py-2 text-sm text-foreground"
            >
              {[1, 2, 3, 4, 5].map((r) => (
                <option key={r} value={r}>
                  {r} 位以内
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              イベントランキング URL（任意）
            </label>
            <input
              name="eventRankingUrl"
              type="url"
              placeholder="https://whowatch.tv/..."
              className="min-h-11 w-full rounded-sm bg-muted px-3 py-2 text-sm text-foreground"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              ランキング上の自分の名前（任意）
            </label>
            <input
              name="myEntryName"
              type="text"
              maxLength={100}
              placeholder="ランキングに表示される名前"
              className="min-h-11 w-full rounded-sm bg-muted px-3 py-2 text-sm text-foreground"
            />
          </div>
        </>
      )}

      {/* 期間（R6: whowatchの実測値がある場合は入力欄を隠し自動設定。無い場合のみ手動入力） */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            開始日時
            {autoPeriodApplied && <span className="ml-1 text-primary">（区分から自動設定・手修正可）</span>}
          </label>
          {autoStartAvailable ? (
            <div className="min-h-11 w-full content-center rounded-sm bg-muted px-3 py-2 text-sm text-foreground">
              {new Date(startTime).toLocaleString("ja-JP")}
            </div>
          ) : (
            <input
              name="startTime"
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              required
              className="min-h-11 w-full rounded-sm bg-muted px-3 py-2 text-sm text-foreground"
            />
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            終了日時
            {autoPeriodApplied && <span className="ml-1 text-primary">（区分から自動設定・手修正可）</span>}
          </label>
          {autoEndAvailable ? (
            <div className="min-h-11 w-full content-center rounded-sm bg-muted px-3 py-2 text-sm text-foreground">
              {new Date(endTime).toLocaleString("ja-JP")}
            </div>
          ) : (
            <>
              <input
                name="endTime"
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
                className="min-h-11 w-full rounded-sm bg-muted px-3 py-2 text-sm text-foreground"
              />
              {platform === "whowatch" && selectedWhowatchEventId && (
                <p className="mt-1 text-xs text-status-warning">
                  whowatchが終了時刻を公開していないため手動設定です(要確認)
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="min-h-11 flex-1 rounded-full bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? "作成中..." : "イベント開始"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-full bg-muted px-4 text-sm text-foreground hover:bg-accent"
        >
          キャンセル
        </button>
      </div>
    </form>
  );
}
