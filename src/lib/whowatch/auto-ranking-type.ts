// 区分（ranking_type）が空のシミュレーターに既定の区分を自動で入れる（2026-10-01 社長指示「イベントでランキング区分が取れないので、今後自動で取ってくるようにして」）。
//
// 5 分同期（src/worker.ts）が毎回、同期の前に呼ぶ。対象は「ふわっちのランキング型・active・期間内・イベント紐付けあり・区分が空」。
//   1. 紐付けたイベントの詳細（whowatch_events）から区分の選択肢を作る。詳細や構造（struct）が保存されていなければ、先に取り直す
//      （event-detail-sync.ts の isDetailFresh: 構造が欠けている行は 10 分で古い扱い）
//   2. シミュレーターの開始日時を含む区分（前半/後半）の「総合」を入れる（ranking-choice.ts pickDefaultRankingType。
//      作成フォームの既定と同じ規則）。区分を入れた次の瞬間から、同じ回の同期の対象になる
// 利用者が後から別の区分を選べば、そちらが優先（ranking_type が空のものだけを書き換える）。

import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import type { createDbClient } from "@/lib/db/client";
import { eventSimulators, whowatchEvents } from "@/lib/db/schema";
import { isUsableStruct, syncEventDetail, viewFromRow } from "./event-detail-sync";
import { flattenRankingChoices } from "./events";
import { pickDefaultRankingType, type PeriodLike } from "./ranking-choice";

type Db = ReturnType<typeof createDbClient>;

/** 順位表を使うイベントタイプ（EventDashboard の isRankingType・worker.ts と同じ） */
export const RANKING_EVENT_TYPES = ["ranking", "nice", "viewer"] as const;
/** 1 回の 5 分同期で区分を入れる上限（1 件あたり DB の UPDATE 1 回と、同じ回の順位取得 1 回が増える） */
export const AUTO_ASSIGN_MAX_PER_RUN = 10;
/** 1 回の 5 分同期で詳細を取り直すイベントの上限（1 件あたり外部 API 最大 5・DB 最大 4。Workers のサブリクエスト上限に余裕を残す） */
export const AUTO_REPAIR_MAX_PER_RUN = 1;

export interface AutoAssignTarget {
  id: string;
  startTime: Date;
  whowatchEventId: number;
}

/** 区分を決めるのに使うイベントの詳細 */
export interface AssignDetail {
  /** RANKING タブの detail。RANKING タブが無いイベントは null（syncEventDetail がそのまま保存する） */
  rankingPrefix: string | null;
  struct: unknown;
  periods: readonly PeriodLike[];
  /** 詳細を一度でも取得したか（detail_fetched_at がある、または今回取り直した）。未取得の null と「RANKING タブ無し」の null を分ける */
  fetched: boolean;
}

export type AutoAssignDecision = { id: string; rankingType: string; optionKey: string | null } | { id: string; skip: string };

/** 区分を決めるには詳細を取り直す必要があるか（詳細が未取得、または RANKING タブはあるのに構造が使えない） */
export function needsDetailRepair(d: Pick<AssignDetail, "rankingPrefix" | "struct" | "fetched">): boolean {
  return !d.fetched || (Boolean(d.rankingPrefix) && !isUsableStruct(d.struct));
}

/** 純関数: シミュレーター 1 件とイベントの詳細から、入れる区分を決める */
export function decideRankingType(sim: AutoAssignTarget, d: AssignDetail | null): AutoAssignDecision {
  if (!d || !d.fetched) return { id: sim.id, skip: "イベントの詳細が未取得" };
  if (!d.rankingPrefix) return { id: sim.id, skip: "このイベントにはランキング区分が無い" };
  if (!isUsableStruct(d.struct)) return { id: sim.id, skip: "区分の構造がまだ取れていない" };
  const choices = flattenRankingChoices(d.rankingPrefix, d.struct);
  const pick = pickDefaultRankingType(choices, d.periods, sim.startTime);
  if (!pick) return { id: sim.id, skip: "区分の選択肢が 0 件" };
  return { id: sim.id, rankingType: pick.rankingType, optionKey: pick.optionKey };
}

export interface AutoAssignResult {
  assigned: Array<{ id: string; rankingType: string }>;
  /** 詳細を API から取り直したイベント（event_key） */
  repaired: string[];
  skipped: Array<{ id: string; reason: string }>;
}

/** 区分が空のシミュレーターに既定の区分を入れる。失敗は呼び出し側（5 分同期）で握る */
export async function autoAssignRankingTypes(db: Db, now: Date): Promise<AutoAssignResult> {
  const result: AutoAssignResult = { assigned: [], repaired: [], skipped: [] };
  const sims = await db
    .select({ id: eventSimulators.id, startTime: eventSimulators.startTime, whowatchEventId: eventSimulators.whowatchEventId })
    .from(eventSimulators)
    .innerJoin(whowatchEvents, eq(whowatchEvents.id, eventSimulators.whowatchEventId))
    .where(
      and(
        eq(eventSimulators.status, "active"),
        eq(eventSimulators.platform, "whowatch"),
        inArray(eventSimulators.eventType, [...RANKING_EVENT_TYPES]),
        isNull(eventSimulators.rankingType),
        lte(eventSimulators.startTime, now),
        gte(eventSimulators.endTime, now),
        // 詳細が未取得、または RANKING タブがあるイベントだけ。RANKING タブが無いイベントは区分を入れようがないので、
        // 毎回の上限枠と取り直しの枠を塞がないよう対象から外す
        or(isNull(whowatchEvents.detailFetchedAt), and(isNotNull(whowatchEvents.rankingPrefix), ne(whowatchEvents.rankingPrefix, ""))),
      ),
    )
    .orderBy(asc(eventSimulators.startTime))
    .limit(AUTO_ASSIGN_MAX_PER_RUN);
  if (sims.length === 0) return result;

  const eventIds = [...new Set(sims.map((s) => s.whowatchEventId).filter((v): v is number => typeof v === "number"))];
  const rows = eventIds.length > 0 ? await db.select().from(whowatchEvents).where(inArray(whowatchEvents.id, eventIds)) : [];
  const details = new Map<number, { eventKey: string; detail: AssignDetail }>(
    rows.map((r) => [
      r.id,
      { eventKey: r.eventKey, detail: { rankingPrefix: r.rankingPrefix, struct: r.struct, periods: viewFromRow(r).periods, fetched: r.detailFetchedAt !== null } },
    ]),
  );

  let repairAttempts = 0;
  for (const sim of sims) {
    if (sim.whowatchEventId === null) continue;
    const entry = details.get(sim.whowatchEventId) ?? null;
    // 詳細や構造が欠けていれば取り直す（10 分以内に取り直したばかりなら API を叩かず DB のまま返る）
    if (entry && needsDetailRepair(entry.detail) && repairAttempts < AUTO_REPAIR_MAX_PER_RUN) {
      repairAttempts++;
      try {
        const v = await syncEventDetail(db, entry.eventKey);
        // 保存に失敗しても、取り直した構造（メモリ上）で区分を決められる
        entry.detail = { rankingPrefix: v.rankingPrefix, struct: v.struct, periods: v.periods, fetched: true };
        if (v.source === "api") result.repaired.push(v.eventKey);
      } catch (e) {
        console.warn("[auto-ranking-type] detail re-fetch failed", entry.eventKey, e instanceof Error ? e.message : String(e));
      }
    }
    const d = decideRankingType({ id: sim.id, startTime: sim.startTime, whowatchEventId: sim.whowatchEventId }, entry?.detail ?? null);
    if ("skip" in d) {
      result.skipped.push({ id: sim.id, reason: d.skip });
      continue;
    }
    // 利用者がその間に区分を選んでいたら上書きしない（ranking_type が空の行だけ）
    const updated = await db
      .update(eventSimulators)
      .set({ rankingType: d.rankingType, updatedAt: now })
      .where(and(eq(eventSimulators.id, sim.id), isNull(eventSimulators.rankingType)))
      .returning({ id: eventSimulators.id });
    if (updated.length > 0) result.assigned.push({ id: sim.id, rankingType: d.rankingType });
  }
  return result;
}
