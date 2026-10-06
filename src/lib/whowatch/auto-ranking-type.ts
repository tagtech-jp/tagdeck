// 区分（ranking_type）が空のシミュレーターに既定の区分を自動で入れる（2026-10-01 社長指示「イベントでランキング区分が取れないので、今後自動で取ってくるようにして」）。
//
// 5 分同期（src/worker.ts）が毎回、同期の前に呼ぶ。対象は「ふわっちのランキング型・active・期間内・イベント紐付けあり・区分が空」。
//   1. 紐付けたイベントの詳細（whowatch_events）から区分の選択肢を作る。詳細や構造（struct）が保存されていなければ、先に取り直す
//      （event-detail-sync.ts の isDetailFresh: 構造が欠けている行は 10 分で古い扱い）
//   2. シミュレーターの開始日時を含む区分（前半/後半）の「総合」を入れる（ranking-choice.ts pickDefaultRankingType。
//      作成フォームの既定と同じ規則）。区分を入れた次の瞬間から、同じ回の同期の対象になる
//   3. 期間限定アイテム型（limited-item・黄金発掘隊・2026-10-07 社長指示「カテゴリーごとに自動的に入れて」）: グループは配信者グレード
//      （K24〜K10）で決まり、公開 API からは本人のグレードが分からない。今日の各グループの順位表を順に見て、本人が載っているグループを入れる。
//      まだどこにも載っていなければ入れずに次回へ回す（既定を K24 にすると違うグループの順位を追ってしまう）
//   4. N-1 グランプリ（prefix "n1"・2026-10-07 社長指示「ナイスも対応して」）: 部門（男性・女性・ルーキー）は本人の属性で決まる。
//      ルーキー部門の順位表に本人の行があればルーキー、無ければ公開プロフィールの性別（男性 / 女性）、それも無ければ男女の順位表に本人の行があるか
//      （publisher_id で上位 100 名の外でも本人の行が返る・2026-10-07 社長報告「N-1 の部門が自動判定のままで入らない」への対応）。
//      全期間（n1-total）は属性に依らないので自動では入れない（利用者が選ぶ）。WGP（prefix "wgp"）は選択肢が固定（デイリー / 月間総合）なので 2. の規則で先頭のデイリーが入る
// 利用者が後から別の区分を選べば、そちらが優先（ranking_type が空のものだけを書き換える）。

import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import type { createDbClient } from "@/lib/db/client";
import { eventSimulators, streamerProfiles, whowatchEvents } from "@/lib/db/schema";
import { isUsableStruct, syncEventDetail, viewFromRow } from "./event-detail-sync";
import { flattenRankingChoices } from "./events";
import { buildLimitedItemRankingType, eventKeyFromLimitedItemPrefix, isLimitedItemPrefix, limitedItemInitFromStruct, type LimitedItemInit } from "./limited-item";
import { buildN1RankingType, isN1Prefix } from "./periodic-ranking";
import { getPublicProfile, type PublicProfile } from "./profile";
import { pickDefaultRankingType, type PeriodLike } from "./ranking-choice";
import { entriesWithPublisher, findMyEntry, getRankings, type RankingEntryApi } from "./rankings";

type Db = ReturnType<typeof createDbClient>;

/** 順位表を使うイベントタイプ（EventDashboard の isRankingType・worker.ts と同じ） */
export const RANKING_EVENT_TYPES = ["ranking", "nice", "viewer"] as const;
/** 1 回の 5 分同期で区分を入れる上限（1 件あたり DB の UPDATE 1 回と、同じ回の順位取得 1 回が増える） */
export const AUTO_ASSIGN_MAX_PER_RUN = 10;
/** 1 回の 5 分同期で詳細を取り直すイベントの上限（1 件あたり外部 API 最大 5・DB 最大 4。Workers のサブリクエスト上限に余裕を残す） */
export const AUTO_REPAIR_MAX_PER_RUN = 1;
/** 1 回の 5 分同期で、期間限定アイテム型のグループ判定（グループ数ぶんの順位表取得）を行うシミュレーターの上限 */
export const AUTO_LIMITED_SCAN_MAX_PER_RUN = 2;

export interface AutoAssignTarget {
  id: string;
  startTime: Date;
  whowatchEventId: number;
}

/** 期間限定アイテム型のグループ判定に要る追加情報 */
export interface AutoAssignLimitedTarget extends AutoAssignTarget {
  endTime: Date;
  /** 自分の特定（streamer_profiles.whowatch_user_id・event_simulators.my_entry_name） */
  whowatchUserId: string | null;
  myEntryName: string | null;
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

/** 純関数: シミュレーター 1 件とイベントの詳細から、入れる区分を決める（期間限定アイテム型は decideLimitedItemRankingType） */
export function decideRankingType(sim: AutoAssignTarget, d: AssignDetail | null): AutoAssignDecision {
  if (!d || !d.fetched) return { id: sim.id, skip: "イベントの詳細が未取得" };
  if (!d.rankingPrefix) return { id: sim.id, skip: "このイベントにはランキング区分が無い" };
  if (!isUsableStruct(d.struct)) return { id: sim.id, skip: "区分の構造がまだ取れていない" };
  const choices = flattenRankingChoices(d.rankingPrefix, d.struct);
  const pick = pickDefaultRankingType(choices, d.periods, sim.startTime);
  if (!pick) return { id: sim.id, skip: "区分の選択肢が 0 件" };
  return { id: sim.id, rankingType: pick.rankingType, optionKey: pick.optionKey };
}

/** 種別（保存形）→ その日の順位表。テストで差し替えるため関数で受ける */
export type LimitedItemLookup = (rankingType: string) => Promise<RankingEntryApi[]>;

/**
 * 期間限定アイテム型: 今日の各グループの順位表に本人が載っているかで区分を決める。
 * ふわっち ID も表示名も無ければ判定できない。グループが無く総合だけのイベントは総合を入れる
 */
export async function decideLimitedItemRankingType(sim: AutoAssignLimitedTarget, rankingPrefix: string, init: LimitedItemInit, lookup: LimitedItemLookup): Promise<AutoAssignDecision> {
  const eventKey = eventKeyFromLimitedItemPrefix(rankingPrefix);
  if (init.groups.length === 0) {
    return init.hasOverall
      ? { id: sim.id, rankingType: buildLimitedItemRankingType(eventKey, "overall"), optionKey: "overall" }
      : { id: sim.id, skip: "グループの選択肢が 0 件" };
  }
  if (!sim.whowatchUserId && !sim.myEntryName) return { id: sim.id, skip: "ふわっち ID が未設定のためグループを判定できない（設定 → プラットフォーム）" };
  for (const g of init.groups) {
    const type = buildLimitedItemRankingType(eventKey, g.id);
    const entries = await lookup(type);
    if (findMyEntry(entries, { whowatchUserId: sim.whowatchUserId, myEntryName: sim.myEntryName })) {
      return { id: sim.id, rankingType: type, optionKey: String(g.id) };
    }
  }
  return { id: sim.id, skip: "今日のランキングにまだ載っていない（載った時点でグループを自動設定）" };
}

/** 部門の判定に使う公開プロフィール（性別だけ使う） */
export type N1ProfileHint = Pick<PublicProfile, "gender"> | null;

/**
 * N-1 グランプリの部門を決める（2026-10-07 社長報告「N-1 の部門が自動判定のままで入らない」= 本人が上位 100 名に居ないと順位表から判定できなかった）:
 *   1. ルーキー部門の順位表に本人の行があれば（publisher_id で圏外でも返る）ルーキー。対象者は開催月限定で、男女部門より入賞しやすい
 *   2. 公開プロフィールの性別（男性 / 女性）があればその部門（順位表に載っていなくても決まる。部門は性別の設定で決まる規則）
 *   3. 性別が未設定なら男性・女性の順位表に本人の行があるか
 *   4. どれも無ければ入れない（ふわっちで性別を設定するか、設定で部門を選んでもらう）
 * ふわっち ID も表示名も無ければ判定できない。全期間（n1-total）は本人の属性に依らないので候補にしない
 */
export async function decideN1RankingType(sim: AutoAssignLimitedTarget, lookup: LimitedItemLookup, profile: N1ProfileHint = null): Promise<AutoAssignDecision> {
  if (!sim.whowatchUserId && !sim.myEntryName) return { id: sim.id, skip: "ふわっち ID が未設定のため部門を判定できない（設定 → プラットフォーム）" };
  const me = { whowatchUserId: sim.whowatchUserId, myEntryName: sim.myEntryName };
  const rookie = buildN1RankingType("rookie");
  if (findMyEntry(await lookup(rookie), me)) return { id: sim.id, rankingType: rookie, optionKey: "rookie" };
  if (profile?.gender === "male" || profile?.gender === "female") {
    return { id: sim.id, rankingType: buildN1RankingType(profile.gender), optionKey: profile.gender };
  }
  for (const division of ["male", "female"] as const) {
    const type = buildN1RankingType(division);
    if (findMyEntry(await lookup(type), me)) return { id: sim.id, rankingType: type, optionKey: division };
  }
  return {
    id: sim.id,
    skip: "今の回の順位表にまだ載っておらず、ふわっちのプロフィールに性別が設定されていないため部門を判定できない（ふわっちで性別を設定するか、「区分・期間を編集」で部門を選ぶ）",
  };
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
    .select({
      id: eventSimulators.id,
      startTime: eventSimulators.startTime,
      endTime: eventSimulators.endTime,
      whowatchEventId: eventSimulators.whowatchEventId,
      userId: eventSimulators.userId,
      myEntryName: eventSimulators.myEntryName,
    })
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

  // 本人のふわっち ID（利用者ごとに 1 回だけ読む）
  const profileCache = new Map<string, string | null>();
  const whowatchUserIdOf = async (userId: string): Promise<string | null> => {
    if (profileCache.has(userId)) return profileCache.get(userId) ?? null;
    const [p] = await db.select({ whowatchUserId: streamerProfiles.whowatchUserId }).from(streamerProfiles).where(eq(streamerProfiles.userId, userId)).limit(1);
    const v = p?.whowatchUserId ?? null;
    profileCache.set(userId, v);
    return v;
  };
  // 公開プロフィール（数値 ID = publisher_id・性別）。取れなくても判定は続ける（10 分キャッシュは profile.ts 側）
  const publicProfileCache = new Map<string, PublicProfile | null>();
  const publicProfileOf = async (whowatchUserId: string | null): Promise<PublicProfile | null> => {
    if (!whowatchUserId) return null;
    if (publicProfileCache.has(whowatchUserId)) return publicProfileCache.get(whowatchUserId) ?? null;
    let v: PublicProfile | null = null;
    try {
      v = await getPublicProfile(whowatchUserId);
    } catch (e) {
      console.warn("[auto-ranking-type] profile lookup failed", whowatchUserId, e instanceof Error ? e.message : String(e));
    }
    publicProfileCache.set(whowatchUserId, v);
    return v;
  };

  let repairAttempts = 0;
  let limitedScans = 0;
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
    const target: AutoAssignTarget = { id: sim.id, startTime: sim.startTime, whowatchEventId: sim.whowatchEventId };
    let d: AutoAssignDecision;
    const fetched = Boolean(entry && entry.detail.fetched);
    const prefix = entry?.detail.rankingPrefix ?? null;
    // 本人が載っている区分を順位表から探す家族（limited-item のグループ・N-1 の部門）で使う。期間はシミュレーターの期間に収めて決める。
    // publisher_id（本人の数値 ID）を付けると、本人が一覧の外（上位 100 名の外）でも本人の行が返るので、それを一覧に足して「載っているか」を見る
    const window = { start: sim.startTime, end: sim.endTime };
    const lookupFor =
      (publisherId: string | null): LimitedItemLookup =>
      async (type) => {
        try {
          return entriesWithPublisher(await getRankings(type, { limit: 100, now, window, ...(publisherId ? { publisherId } : {}) }));
        } catch (e) {
          console.warn("[auto-ranking-type] division lookup failed", type, e instanceof Error ? e.message : String(e));
          return [];
        }
      };
    if (fetched && isLimitedItemPrefix(prefix)) {
      const init = limitedItemInitFromStruct(entry!.detail.struct);
      if (!init) d = { id: sim.id, skip: "区分の構造がまだ取れていない" };
      else if (limitedScans >= AUTO_LIMITED_SCAN_MAX_PER_RUN) d = { id: sim.id, skip: "今回のグループ判定の上限（次回の同期で判定）" };
      else {
        limitedScans++;
        const whowatchUserId = await whowatchUserIdOf(sim.userId);
        const profile = await publicProfileOf(whowatchUserId);
        d = await decideLimitedItemRankingType({ ...target, endTime: sim.endTime, whowatchUserId, myEntryName: sim.myEntryName }, prefix as string, init, lookupFor(profile?.userId ?? null));
      }
    } else if (fetched && isN1Prefix(prefix)) {
      if (limitedScans >= AUTO_LIMITED_SCAN_MAX_PER_RUN) d = { id: sim.id, skip: "今回の部門判定の上限（次回の同期で判定）" };
      else {
        limitedScans++;
        const whowatchUserId = await whowatchUserIdOf(sim.userId);
        const profile = await publicProfileOf(whowatchUserId);
        d = await decideN1RankingType({ ...target, endTime: sim.endTime, whowatchUserId, myEntryName: sim.myEntryName }, lookupFor(profile?.userId ?? null), profile);
      }
    } else {
      d = decideRankingType(target, entry?.detail ?? null);
    }
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
