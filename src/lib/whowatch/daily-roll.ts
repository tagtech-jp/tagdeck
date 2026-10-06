// 期間が切り替わるシミュレーターの期間を、期間が終わったら次の区切りへ自動で進める
// （2026-10-07 社長指示「1 日ごとに区切って開始終了を自動設定してほしい」。同日の WGP・N-1 対応で、日替わりだけでなく
//   N-1 の回（1 日・11 日・21 日の 0:00）と月（WGP 総合・N-1 全期間）にも広げた。関数名は日替わり時代のまま）。
//
// 5 分同期（src/worker.ts）が毎回、区分の自動設定と順位の同期より前に呼ぶ。
// 対象: ふわっち・active・ランキング型・終了日時を過ぎた（DAILY_ROLL_LOOKBACK_MS 以内）もので、期間の切り替え方が決まるもの:
//   (a) 種別が期間切り替え型（limited-item のグループ・wgp-daily・wgp-overall・n1-*）→ その種別の切り替え方（periodic-ranking.ts）
//   (b) 種別が空（区分の自動判定待ち）→ 紐付けイベントの prefix（limited-item / wgp は日替わり、n1 は回）。それも無ければ kind = daily なら日替わり
// 期間が「1 期間ぶん」（periodMaxSpanMs 以下）のものだけ。利用者が長い期間（全期間など）を手で設定したシミュレーターは動かさない。
// 新しい期間 = 今を含む期間（イベントの終了で切る。N-1 は常設なので終了を見ない）。進めた直後の同じ回の同期で、区分の自動設定と順位の取得が走る。

import { and, eq, gte, inArray, lte } from "drizzle-orm";
import type { createDbClient } from "@/lib/db/client";
import { eventSimulators, whowatchEvents } from "@/lib/db/schema";
import { RANKING_EVENT_TYPES } from "./auto-ranking-type";
import { endTimeFromEndedAt } from "./events";
import { defaultPeriodWindow, isPerpetualFamily, periodicSchemeFor, periodMaxSpanMs, type PeriodScheme } from "./periodic-ranking";

type Db = ReturnType<typeof createDbClient>;

/** 日替わりで「1 日ぶん」とみなす最長の幅（36 時間 = computeEventKind のデイリー判定と同じ）。他の切り替え方は periodMaxSpanMs */
export const DAILY_ROLL_MAX_SPAN_MS = periodMaxSpanMs("daily");
/** 終了日時がこれより前のシミュレーターは見ない（毎回の対象を絞る。同期が 7 日以上止まっていたら手で期間を直す） */
export const DAILY_ROLL_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export interface DailyRollCandidate {
  id: string;
  startTime: Date;
  endTime: Date;
  /** シミュレーターの区分（空 = 自動判定待ち） */
  rankingType?: string | null;
  /** 紐付けイベントの kind（'daily' | 'long' | null）と RANKING タブの prefix */
  eventKind?: string | null;
  eventRankingPrefix?: string | null;
  /** 紐付けイベントの ended_at（23:59:59 JST の慣例。無ければ null = 終わりが分からない） */
  eventEndedAt: Date | null;
  eventStatus: string | null;
}

/** 候補の期間の切り替え方。決まらなければ null（進めない） */
export function rollSchemeOf(c: Pick<DailyRollCandidate, "rankingType" | "eventKind" | "eventRankingPrefix">): PeriodScheme | null {
  const scheme = periodicSchemeFor(c.eventRankingPrefix, c.rankingType) ?? (c.eventKind === "daily" && !c.rankingType ? "daily" : null);
  return scheme === "whole" ? null : scheme;
}

/** 純関数: 進めるなら新しい期間、進めないなら null */
export function decideDailyRoll(c: DailyRollCandidate, now: Date): { start: Date; end: Date } | null {
  const scheme = rollSchemeOf(c);
  if (!scheme) return null;
  if (c.endTime.getTime() > now.getTime()) return null; // まだ期間中
  if (c.endTime.getTime() - c.startTime.getTime() > periodMaxSpanMs(scheme)) return null; // 1 期間ぶんの期間だけ
  if (c.eventStatus === "closed") return null;
  // N-1 は常設（whowatch_events の日付は「今月」が入るだけ）なので、イベントの終了では止めない
  const eventEnd = !isPerpetualFamily(c.rankingType, c.eventRankingPrefix) && c.eventEndedAt ? endTimeFromEndedAt(c.eventEndedAt.getTime()) : null;
  if (eventEnd && eventEnd.getTime() <= now.getTime()) return null; // イベントが終わった
  const w = defaultPeriodWindow(scheme, now, { start: null, end: eventEnd });
  if (w.end.getTime() <= c.endTime.getTime()) return null; // 進まない（同じ期間）
  return { start: w.start, end: w.end };
}

export interface DailyRollResult {
  rolled: Array<{ id: string; start: Date; end: Date }>;
}

/** 終了日時を過ぎた期間切り替え型のシミュレーターを今の区切りへ進める。失敗は呼び出し側（5 分同期）で握る */
export async function rollDailySimulators(db: Db, now: Date): Promise<DailyRollResult> {
  const result: DailyRollResult = { rolled: [] };
  const rows = await db
    .select({
      id: eventSimulators.id,
      startTime: eventSimulators.startTime,
      endTime: eventSimulators.endTime,
      rankingType: eventSimulators.rankingType,
      eventKind: whowatchEvents.kind,
      eventRankingPrefix: whowatchEvents.rankingPrefix,
      eventEndedAt: whowatchEvents.endedAt,
      eventStatus: whowatchEvents.status,
    })
    .from(eventSimulators)
    .innerJoin(whowatchEvents, eq(whowatchEvents.id, eventSimulators.whowatchEventId))
    .where(
      and(
        eq(eventSimulators.status, "active"),
        eq(eventSimulators.platform, "whowatch"),
        inArray(eventSimulators.eventType, [...RANKING_EVENT_TYPES]),
        lte(eventSimulators.endTime, now),
        gte(eventSimulators.endTime, new Date(now.getTime() - DAILY_ROLL_LOOKBACK_MS)),
      ),
    );
  for (const r of rows) {
    const d = decideDailyRoll(r, now);
    if (!d) continue;
    // 利用者がその間に期間を変えていたら上書きしない（終了日時がそのままの行だけ）
    const updated = await db
      .update(eventSimulators)
      .set({ startTime: d.start, endTime: d.end, updatedAt: now })
      .where(and(eq(eventSimulators.id, r.id), eq(eventSimulators.endTime, r.endTime)))
      .returning({ id: eventSimulators.id });
    if (updated.length > 0) result.rolled.push({ id: r.id, start: d.start, end: d.end });
  }
  return result;
}
