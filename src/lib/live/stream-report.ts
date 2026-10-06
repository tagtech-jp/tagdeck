// 配信後の振り返りレポート（2026-10-06 社長指示）。
//
// 配信単位の記録テーブルは無いため、live/poll が保存したギフト（events・event_type='gift'）を
// 配信（stream_id = live_id）ごとに集計する（純関数）。コメント数・視聴者数の推移は保存していないので出さない。
// 金額は payload.total_yen（単価 × 個数・単価不明は 0 として扱う）。匿名の投げは人数・上位から外す。

export interface StreamGiftRow {
  occurredAt: Date;
  /** listeners.id。匿名は null */
  listenerId: string | null;
  name: string | null;
  itemName: string | null;
  count: number;
  totalYen: number | null;
}

export interface StreamReport {
  startedAt: string;
  endedAt: string;
  giftCount: number;
  /** 合計金額（単価が分かる分だけ） */
  totalYen: number;
  /** 投げた人数（匿名を除く） */
  giverCount: number;
  anonymousGiftCount: number;
  /** 金額の多い順（同額は回数の多い順）。最大 TOP_GIVERS 人 */
  topGivers: Array<{ name: string; totalYen: number; gifts: number }>;
  /** この配信で初めて投げた人（firstGiftAt がこの配信の開始以降） */
  firstTimers: string[];
  /** 金額の多いアイテム。最大 TOP_ITEMS 個 */
  topItems: Array<{ name: string; count: number; totalYen: number }>;
  /** 金額が最も多かった PEAK_WINDOW_MINUTES 分間（ギフトが無ければ null） */
  peak: { from: string; to: string; totalYen: number; gifts: number } | null;
}

export const TOP_GIVERS = 5;
export const TOP_ITEMS = 5;
export const PEAK_WINDOW_MINUTES = 10;

/**
 * @param firstGiftAt listenerId → その人がこの配信者に初めて投げた時刻（全配信を通して）
 */
export function summarizeStream(rows: readonly StreamGiftRow[], firstGiftAt: ReadonlyMap<string, Date>): StreamReport | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const start = sorted[0].occurredAt;
  const end = sorted[sorted.length - 1].occurredAt;
  const yen = (r: StreamGiftRow) => (r.totalYen !== null && Number.isFinite(r.totalYen) && r.totalYen > 0 ? r.totalYen : 0);

  const givers = new Map<string, { name: string; totalYen: number; gifts: number }>();
  const items = new Map<string, { name: string; count: number; totalYen: number }>();
  let totalYen = 0;
  let anonymous = 0;
  for (const r of sorted) {
    totalYen += yen(r);
    if (r.listenerId === null) anonymous++;
    else {
      const g = givers.get(r.listenerId) ?? { name: r.name ?? "（名前不明）", totalYen: 0, gifts: 0 };
      g.totalYen += yen(r);
      g.gifts++;
      if (r.name) g.name = r.name;
      givers.set(r.listenerId, g);
    }
    const key = r.itemName ?? "（不明なアイテム）";
    const it = items.get(key) ?? { name: key, count: 0, totalYen: 0 };
    it.count += r.count;
    it.totalYen += yen(r);
    items.set(key, it);
  }

  const firstTimers: string[] = [];
  for (const [id, g] of givers) {
    const first = firstGiftAt.get(id);
    if (first && first.getTime() >= start.getTime()) firstTimers.push(g.name);
  }

  // 金額が最も多い 10 分間（各ギフトの時刻を窓の始まりとして尺取り）
  const windowMs = PEAK_WINDOW_MINUTES * 60_000;
  let peak: StreamReport["peak"] = null;
  let j = 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < sorted.length; i++) {
    while (j < sorted.length && sorted[j].occurredAt.getTime() < sorted[i].occurredAt.getTime() + windowMs) {
      sum += yen(sorted[j]);
      n++;
      j++;
    }
    if (!peak || sum > peak.totalYen || (sum === peak.totalYen && n > peak.gifts)) {
      const from = sorted[i].occurredAt;
      peak = { from: from.toISOString(), to: new Date(from.getTime() + windowMs).toISOString(), totalYen: sum, gifts: n };
    }
    sum -= yen(sorted[i]);
    n--;
  }

  return {
    startedAt: start.toISOString(),
    endedAt: end.toISOString(),
    giftCount: sorted.length,
    totalYen,
    giverCount: givers.size,
    anonymousGiftCount: anonymous,
    topGivers: [...givers.values()].sort((a, b) => b.totalYen - a.totalYen || b.gifts - a.gifts).slice(0, TOP_GIVERS),
    firstTimers,
    topItems: [...items.values()].sort((a, b) => b.totalYen - a.totalYen || b.count - a.count).slice(0, TOP_ITEMS),
    peak,
  };
}
