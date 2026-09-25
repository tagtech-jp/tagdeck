// イベント詳細（/event_lists/{key} → /resources/json/rankings/{prefix} → 概要 notification → periods）の取得と
// whowatch_events への保存を 1 か所にまとめる。呼び出し元:
//   - GET /api/platforms/whowatch/events/{event_key}（フォームのイベント選択時・オンデマンド）
//   - POST /api/platforms/whowatch/events/sync（open/pre 全件・Daily whowatch sync と手動実行）
// 2026-09-21 までは前者しか無く、本番で誰もイベントを選択していなければ詳細列は NULL のままだった。

import { eq } from "drizzle-orm";
import type { createDbClient } from "@/lib/db/client";
import { whowatchEvents } from "@/lib/db/schema";
import {
  EVENT_CACHE_TTL_MS,
  WhowatchEventApiError,
  computeEventKind,
  endTimeFromEndedAt,
  flattenRankingChoices,
  getEventDetail,
  getEventLists,
  getRankingStruct,
  getRules,
  type EventListItem,
  type RankingStruct,
} from "./events";
import { resolveEventPeriods, type EventPeriod } from "./periods";
import { describeDbError, sanitizeJson, sanitizeText, slimHtml } from "./sanitize";
import { parseRules, RULES_PARSER_VERSION, type RulesParsed } from "./rules-parser";

type Db = ReturnType<typeof createDbClient>;
type EventRow = typeof whowatchEvents.$inferSelect;

/** DB の詳細列がこれより古ければ再取得する（オンデマンド時の既定。API 側は 10 分の in-memory キャッシュ） */
export const DETAIL_STALE_MS = 24 * 60 * 60 * 1000;

/**
 * 1 リクエストで処理するイベント数の既定。Cloudflare Workers はリクエストあたりのサブリクエスト上限（無料 50）があり、
 * 1 イベントあたり 外部 API 最大 4（詳細 1 + 構造 1 + 概要通知 最大 2）+ DB 2（select / upsert）= 最大 6、
 * 加えて一覧取得 1。3 件なら 19 で上限内。続きは cursor で再呼び出しする。
 */
export const SYNC_BATCH_LIMIT = 3;
/** 1 イベントあたり読む NOTIFICATION タブ数（概要 + 特典）。periods に必要なのは先頭の概要 */
export const MAX_NOTIFICATIONS_PER_EVENT = 2;

/** どの段階で失敗したかを付けた例外 */
export class EventDetailSyncError extends Error {
  constructor(
    public stage: "detail" | "struct" | "rules" | "db",
    public eventKey: string,
    cause: unknown,
  ) {
    super(`[${stage}] ${eventKey}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "EventDetailSyncError";
  }
}

export interface EventDetailView {
  id: number | null;
  eventKey: string;
  name: string;
  shortName: string;
  status: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  kind: string | null;
  rankingPrefix: string | null;
  struct: RankingStruct | null;
  rulesText: string | null;
  rulesHtml: string | null;
  periods: EventPeriod[];
  /** E3: 当たり倍率表・ボーナス表・無料アイテムの抽出結果（rules_text から。無ければ null） */
  rulesParsed: RulesParsed | null;
  source: "db" | "api";
  /** 区分なし・通知取得失敗などの補足（正常終了の範囲） */
  note?: string | null;
}

/** DB の rules_parsed がパーサ版一致ならそれ、違えば rules_text から再解析 */
export function pickRulesParsed(stored: unknown, rulesText: string | null): RulesParsed | null {
  if (stored && typeof stored === "object" && (stored as { parserVersion?: number }).parserVersion === RULES_PARSER_VERSION) {
    return stored as RulesParsed;
  }
  return rulesText ? parseRules(rulesText, new Date()) : null;
}

export function computePeriods(rulesText: string | null, struct: RankingStruct | null, startedAt: Date | null, endedAt: Date | null): EventPeriod[] {
  const options = Array.isArray(struct?.options) ? struct!.options!.map((o) => ({ key: o.key, value: o.value })) : [];
  // 全体の終了は ended_at(23:59:59 JST) + 1 秒 = 翌日 00:00 JST に揃える（区分の ends_at と同じ基準）
  const overallEnd = endedAt ? endTimeFromEndedAt(endedAt.getTime()) : null;
  return resolveEventPeriods(rulesText, options, { startsAt: startedAt, endsAt: overallEnd });
}

export function viewFromRow(row: EventRow): EventDetailView {
  const struct = (row.struct ?? null) as RankingStruct | null;
  return {
    id: row.id,
    eventKey: row.eventKey,
    name: row.name ?? row.titleJa ?? row.eventKey,
    shortName: row.shortName ?? row.name ?? row.eventKey,
    status: row.status,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    kind: row.kind,
    rankingPrefix: row.rankingPrefix,
    struct,
    rulesText: row.rulesText,
    rulesHtml: row.rulesHtml,
    periods: (row.periods as EventPeriod[] | null) ?? computePeriods(row.rulesText, struct, row.startedAt, row.endedAt),
    rulesParsed: pickRulesParsed(row.rulesParsed, row.rulesText),
    source: "db",
  };
}

/** API 応答用の形（rankingChoices / endTime を付与） */
export function shapeEventDetail(v: EventDetailView) {
  const endedMs = v.endedAt?.getTime() ?? null;
  return {
    id: v.id,
    eventKey: v.eventKey,
    name: v.name,
    shortName: v.shortName,
    status: v.status,
    startedAt: v.startedAt?.toISOString() ?? null,
    endedAt: v.endedAt?.toISOString() ?? null,
    endTime: endedMs ? endTimeFromEndedAt(endedMs).toISOString() : null,
    kind: v.kind,
    rankingPrefix: v.rankingPrefix,
    rankingChoices: v.rankingPrefix ? flattenRankingChoices(v.rankingPrefix, v.struct) : [],
    struct: v.struct,
    // 区分ごとの期間。ends_at は「24:00」を翌日 00:00 JST に正規化済みなので、そのまま endTime に使える
    periods: v.periods,
    rulesText: v.rulesText,
    rulesParsed: v.rulesParsed,
    hasRulesHtml: Boolean(v.rulesHtml),
    detailFetchedAt: null as string | null,
    source: v.source,
  };
}

export interface SyncEventDetailOptions {
  /** true なら DB の鮮度に関係なく API から取り直す */
  force?: boolean;
  /** DB の detail_fetched_at がこれより新しければ DB を返す（既定 DETAIL_STALE_MS） */
  maxAgeMs?: number;
  /** 既に取得済みの一覧（全件同期で使い回す） */
  lists?: { open: EventListItem[]; pre: EventListItem[]; closed: EventListItem[] };
}

/**
 * 1 イベントの詳細を取得して whowatch_events に保存し、ビューを返す。
 * 失敗は例外として投げる（呼び出し側でログ／通知）。
 */
export async function syncEventDetail(db: Db, eventKey: string, opts: SyncEventDetailOptions = {}): Promise<EventDetailView> {
  const maxAge = opts.maxAgeMs ?? DETAIL_STALE_MS;
  const [row] = await db.select().from(whowatchEvents).where(eq(whowatchEvents.eventKey, eventKey)).limit(1);
  if (!opts.force && row?.detailFetchedAt && row.rankingPrefix !== null && Date.now() - row.detailFetchedAt.getTime() < maxAge) {
    return viewFromRow(row);
  }

  let detail: Awaited<ReturnType<typeof getEventDetail>>;
  let lists: NonNullable<SyncEventDetailOptions["lists"]>;
  try {
    [detail, lists] = await Promise.all([getEventDetail(eventKey), opts.lists ?? getEventLists()]);
  } catch (e) {
    throw new EventDetailSyncError("detail", eventKey, e);
  }
  const listed = [...lists.open, ...lists.pre, ...lists.closed].find((e) => e.eventKey === eventKey) ?? null;

  // 構造 JSON: RANKING タブが無いイベントは「区分なし」として正常。404 も区分なし扱い（他のエラーは失敗）
  let struct: RankingStruct | null = null;
  let structNote: string | null = detail.rankingPrefix ? null : "区分なし（RANKING タブ無し）";
  if (detail.rankingPrefix) {
    try {
      struct = await getRankingStruct(detail.rankingPrefix);
    } catch (e) {
      if (e instanceof WhowatchEventApiError && e.status === 404) {
        structNote = `区分なし（構造 JSON が 404: ${detail.rankingPrefix}）`;
      } else {
        throw new EventDetailSyncError("struct", eventKey, e);
      }
    }
  }

  // ルール本文: NOTIFICATION（概要・特典）をテキスト化して連結、HTML は先頭（概要）のみ保存。個別の失敗は握って続行
  let rulesHtml: string | null = null;
  const rulesTextParts: string[] = [];
  const rulesErrors: string[] = [];
  for (const nid of detail.notificationIds.slice(0, MAX_NOTIFICATIONS_PER_EVENT)) {
    try {
      const r = await getRules(nid);
      if (rulesHtml === null) rulesHtml = r.html;
      rulesTextParts.push(`## ${r.title}\n${r.text}`);
    } catch (e) {
      rulesErrors.push(`${nid}: ${e instanceof Error ? e.message : String(e)}`);
      console.warn("[event-detail-sync] rules fetch failed", eventKey, nid, e);
    }
  }
  const rulesText = rulesTextParts.length > 0 ? rulesTextParts.join("\n\n") : null;

  const startedAt = listed?.startedAt ? new Date(listed.startedAt) : (row?.startedAt ?? null);
  const endedAt = listed?.endedAt ? new Date(listed.endedAt) : (row?.endedAt ?? null);
  const kind = computeEventKind(startedAt?.getTime() ?? null, endedAt?.getTime() ?? null);
  const periods = computePeriods(rulesText, struct, startedAt, endedAt);
  const rulesParsed = rulesText ? parseRules(rulesText, new Date()) : null;
  const now = new Date();

  const id = listed?.id ?? row?.id ?? null;
  let dbWarning: string | null = null;
  if (id !== null) {
    // 小さい列（名前・区分・periods・取得時刻）を先に upsert。ここが失敗したらイベント失敗
    const periodsClean = periods.length > 0 ? sanitizeJson(periods) : null;
    const smallCols = {
      name: sanitizeText(detail.name) || null,
      shortName: sanitizeText(detail.shortName) || null,
      kind,
      rankingPrefix: detail.rankingPrefix,
      periods: periodsClean,
      rulesParsed: rulesParsed ? (sanitizeJson(rulesParsed) as unknown as Record<string, unknown>) : null,
      detailFetchedAt: now,
    };
    try {
      await db
        .insert(whowatchEvents)
        .values({
          id,
          eventKey,
          bannerUrl: listed?.bannerUrl ?? row?.bannerUrl ?? "",
          status: listed?.status ?? row?.status ?? "open",
          badgeText: listed?.badgeText ?? row?.badgeText ?? null,
          startedAt,
          endedAt,
          participants: listed?.participants ?? row?.participants ?? null,
          lastSyncedAt: row?.lastSyncedAt ?? now,
          ...smallCols,
        })
        .onConflictDoUpdate({
          target: whowatchEvents.id,
          set: {
            ...smallCols,
            ...(startedAt ? { startedAt } : {}),
            ...(endedAt ? { endedAt } : {}),
          },
        });
    } catch (e) {
      throw new EventDetailSyncError("db", eventKey, describeDbError(e));
    }

    // 大きい列（rules_html / rules_text / struct）は別 UPDATE。失敗しても小さい列の保存は残す（参考情報なので警告扱い）
    try {
      await db
        .update(whowatchEvents)
        .set({
          rulesText: rulesText ? sanitizeText(rulesText) : null,
          struct: struct ? (sanitizeJson(struct) as Record<string, unknown>) : null,
        })
        .where(eq(whowatchEvents.id, id));
    } catch (e) {
      dbWarning = `rules_text/struct の保存に失敗: ${describeDbError(e)}`;
      console.warn("[event-detail-sync] large columns (text/struct) failed", eventKey, dbWarning);
    }
    try {
      await db
        .update(whowatchEvents)
        .set({ rulesHtml: rulesHtml ? slimHtml(rulesHtml) : null })
        .where(eq(whowatchEvents.id, id));
    } catch (e) {
      const w = `rules_html の保存に失敗: ${describeDbError(e)}`;
      dbWarning = dbWarning ? `${dbWarning} / ${w}` : w;
      console.warn("[event-detail-sync] large column (html) failed", eventKey, w);
    }
  }

  return {
    id,
    eventKey,
    note: [structNote, rulesErrors.length > 0 ? `通知取得失敗: ${rulesErrors.join("; ")}` : null, dbWarning].filter(Boolean).join(" / ") || null,
    name: detail.name || eventKey,
    shortName: detail.shortName || detail.name || eventKey,
    status: listed?.status ?? row?.status ?? null,
    startedAt,
    endedAt,
    kind,
    rankingPrefix: detail.rankingPrefix,
    struct,
    rulesText,
    rulesHtml,
    periods,
    rulesParsed,
    source: "api",
  };
}

export interface SyncAllResult {
  at: string;
  /** open/pre の全件数 */
  targets: number;
  /** 今回のバッチで処理した件数 */
  processed: number;
  succeeded: number;
  failed: number;
  /** 次バッチの cursor（無ければ null = 完了） */
  next_cursor: string | null;
  results: Array<{
    eventKey: string;
    ok: boolean;
    source?: "db" | "api";
    periods?: number;
    rankingPrefix?: string | null;
    name?: string;
    note?: string | null;
    stage?: string;
    error?: string;
  }>;
}

export interface SyncAllOptions {
  force?: boolean;
  maxAgeMs?: number;
  /** 1 バッチの件数（既定 SYNC_BATCH_LIMIT） */
  limit?: number;
  /** 前回応答の next_cursor（event_key 昇順の位置） */
  cursor?: string | null;
  /** 単体実行 */
  eventKey?: string | null;
}

/** 対象を決める純関数: open/pre を event_key 昇順に並べ、cursor 以降を limit 件。eventKey 指定なら 1 件 */
export function planSyncTargets(
  lists: { open: EventListItem[]; pre: EventListItem[] },
  opts: { limit?: number; cursor?: string | null; eventKey?: string | null } = {},
): { total: number; batch: EventListItem[]; nextCursor: string | null } {
  const seen = new Set<string>();
  const all = [...lists.open, ...lists.pre]
    .filter((e) => e.eventKey && !seen.has(e.eventKey) && seen.add(e.eventKey))
    .sort((a, b) => (a.eventKey < b.eventKey ? -1 : a.eventKey > b.eventKey ? 1 : 0));
  if (opts.eventKey) {
    const one = all.find((e) => e.eventKey === opts.eventKey);
    return { total: all.length, batch: one ? [one] : [{ id: -1, eventKey: opts.eventKey, bannerUrl: "", status: "open", badgeText: null, canEntry: null, participants: null, startedAt: null, endedAt: null }], nextCursor: null };
  }
  const limit = Math.max(1, Math.min(10, opts.limit ?? SYNC_BATCH_LIMIT));
  const startIdx = opts.cursor ? all.findIndex((e) => e.eventKey > opts.cursor!) : 0;
  if (startIdx < 0) return { total: all.length, batch: [], nextCursor: null };
  const batch = all.slice(startIdx, startIdx + limit);
  const last = batch[batch.length - 1];
  const hasMore = startIdx + limit < all.length;
  return { total: all.length, batch, nextCursor: hasMore && last ? last.eventKey : null };
}

/**
 * open/pre のイベント詳細をバッチで同期する（Daily whowatch sync・手動実行用）。
 * 各イベントは独立して try/catch し、1 件の失敗で他を巻き込まない。続きは next_cursor で再呼び出し。
 */
export async function syncAllEventDetails(db: Db, opts: SyncAllOptions = {}): Promise<SyncAllResult> {
  const lists = await getEventLists();
  const plan = planSyncTargets(lists, opts);
  const results: SyncAllResult["results"] = [];
  for (const e of plan.batch) {
    try {
      const v = await syncEventDetail(db, e.eventKey, { force: opts.force, maxAgeMs: opts.maxAgeMs ?? EVENT_CACHE_TTL_MS, lists });
      results.push({ eventKey: e.eventKey, ok: true, source: v.source, periods: v.periods.length, rankingPrefix: v.rankingPrefix, name: v.name, note: v.note ?? null });
    } catch (err) {
      const stage = err instanceof EventDetailSyncError ? err.stage : "unknown";
      const message = err instanceof EventDetailSyncError ? err.message : describeDbError(err);
      console.error("[event-detail-sync] failed", e.eventKey, stage, message);
      results.push({ eventKey: e.eventKey, ok: false, stage, error: message });
    }
  }
  return {
    at: new Date().toISOString(),
    targets: plan.total,
    processed: plan.batch.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    next_cursor: plan.nextCursor,
    results,
  };
}
