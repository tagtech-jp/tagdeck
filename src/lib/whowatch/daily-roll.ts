// 日替わり（デイリー）のシミュレーターの期間を、日が変わったら翌日の区切りへ自動で進める（2026-10-07 社長指示「1 日ごとに区切って開始終了を自動設定してほしい」）。
//
// 5 分同期（src/worker.ts）が毎回、区分の自動設定と順位の同期より前に呼ぶ。
// 対象: ふわっち・active・ランキング型・紐付けイベントが kind = daily（期間限定アイテム型など、毎日 0:00 に順位表が切り替わるイベント）・
//       期間が 1 日ぶん（DAILY_ROLL_MAX_SPAN_MS 以下）・終了日時を過ぎた・イベントがまだ終わっていない。
// 新しい期間 = 今日（JST）の 0:00〜翌 0:00（イベントの終了で切る）。利用者が長い期間（全期間など）を手で設定したシミュレーターは動かさない。
// 進めた直後の同じ回の同期で、区分の自動設定（グループ判定）と順位の取得が走る。

import { and, eq, inArray, lte } from "drizzle-orm";
import type { createDbClient } from "@/lib/db/client";
import { eventSimulators, whowatchEvents } from "@/lib/db/schema";
import { RANKING_EVENT_TYPES } from "./auto-ranking-type";
import { endTimeFromEndedAt } from "./events";
import { dailySimulatorWindow } from "./limited-item";

type Db = ReturnType<typeof createDbClient>;

/** これより長い期間のシミュレーターは「1 日ぶん」ではないので進めない（36 時間 = computeEventKind のデイリー判定と同じ幅） */
export const DAILY_ROLL_MAX_SPAN_MS = 36 * 60 * 60 * 1000;

export interface DailyRollCandidate {
  id: string;
  startTime: Date;
  endTime: Date;
  /** 紐付けイベントの ended_at（23:59:59 JST の慣例。無ければ null = 終わりが分からない） */
  eventEndedAt: Date | null;
  eventStatus: string | null;
}

/** 純関数: 進めるなら新しい期間、進めないなら null */
export function decideDailyRoll(c: DailyRollCandidate, now: Date): { start: Date; end: Date } | null {
  if (c.endTime.getTime() > now.getTime()) return null; // まだ期間中
  if (c.endTime.getTime() - c.startTime.getTime() > DAILY_ROLL_MAX_SPAN_MS) return null; // 1 日ぶんの期間だけ
  if (c.eventStatus === "closed") return null;
  const eventEnd = c.eventEndedAt ? endTimeFromEndedAt(c.eventEndedAt.getTime()) : null;
  if (eventEnd && eventEnd.getTime() <= now.getTime()) return null; // イベントが終わった
  const w = dailySimulatorWindow(now, { start: null, end: eventEnd });
  if (w.end.getTime() <= c.endTime.getTime()) return null; // 進まない（同じ日）
  return { start: w.start, end: w.end };
}

export interface DailyRollResult {
  rolled: Array<{ id: string; start: Date; end: Date }>;
}

/** 終了日時を過ぎた日替わりのシミュレーターを今日の区切りへ進める。失敗は呼び出し側（5 分同期）で握る */
export async function rollDailySimulators(db: Db, now: Date): Promise<DailyRollResult> {
  const result: DailyRollResult = { rolled: [] };
  const rows = await db
    .select({
      id: eventSimulators.id,
      startTime: eventSimulators.startTime,
      endTime: eventSimulators.endTime,
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
        eq(whowatchEvents.kind, "daily"),
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
