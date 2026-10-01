// イベント詳細（/event_lists/{key} → /resources/json/rankings/{prefix} → 概要 notification → periods）の取得と
// whowatch_events への保存を 1 か所にまとめる。呼び出し元:
//   - GET /api/platforms/whowatch/events/{event_key}（フォームのイベント選択時・オンデマンド）
//   - POST /api/platforms/whowatch/events/sync（open/pre 全件・Daily whowatch sync と手動実行）
// 2026-09-21 までは前者しか無く、本番で誰もイベントを選択していなければ詳細列は NULL のままだった。

import { eq, sql } from "drizzle-orm";
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
 * ランキング prefix があるのに区分の構造（struct）が保存されていないイベントは、24 時間を待たずにこの間隔で取り直す（2026-10-01）。
 * 実害: 2026_10_magicfantasy で日次同期の struct 保存が「Network connection lost」で失敗し、取得時刻だけ記録されて
 * 24 時間「区分がありません」のままになった。未公開（構造 JSON が 404 / error_code）のイベントも同じ間隔で取り直す
 */
export const STRUCT_RETRY_MS = 10 * 60 * 1000;

/** 区分の構造として使えるか。NULL・配列・未公開時の応答（{"error_code":"Z-002",…}。修正前に保存された行）は使えない */
export function isUsableStruct(struct: unknown): struct is RankingStruct {
  return typeof struct === "object" && struct !== null && !Array.isArray(struct) && !("error_code" in struct);
}

/** DB の詳細をそのまま使ってよいか（純関数）。構造が欠けている行は STRUCT_RETRY_MS で古い扱いにする */
export function isDetailFresh(
  row: Pick<EventRow, "detailFetchedAt" | "rankingPrefix" | "struct"> | null | undefined,
  nowMs: number,
  maxAgeMs: number = DETAIL_STALE_MS,
): boolean {
  if (!row?.detailFetchedAt || row.rankingPrefix === null) return false;
  const missingStruct = row.rankingPrefix !== "" && !isUsableStruct(row.struct);
  const limit = missingStruct ? Math.min(maxAgeMs, STRUCT_RETRY_MS) : maxAgeMs;
  return nowMs - row.detailFetchedAt.getTime() < limit;
}

/**
 * 1 回の UPDATE で送る本文の上限（UTF-8 のバイト数）。
 * 2026-10-01 本番の実測: Workers から DB への 1 回の書き込みが 76,806 / 86,898 バイトのときは毎回「Network connection lost」で失敗した。
 * 61,298 / 53,045 バイトは成功した。約 64KB を超えると落ちると見られる（どの層の制限かは未確認）。
 * 2026_10_magicfantasy はルール本文が 72,594 バイトあり、同じ UPDATE に入れていた struct ごと保存できず、区分が出なかった。
 * 余裕を見て 16KB ずつに分ける
 */
export const DB_WRITE_CHUNK_BYTES = 16 * 1024;

/** 純関数: UTF-8 のバイト数が maxBytes 以下になるよう、文字の境目で分ける（空文字は [""]） */
export function splitUtf8ByBytes(text: string, maxBytes: number): string[] {
  const limit = Math.max(4, Math.floor(maxBytes));
  const out: string[] = [];
  let start = 0;
  let bytes = 0;
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i) ?? 0;
    const len = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + len > limit) {
      out.push(text.slice(start, i));
      start = i;
      bytes = 0;
    }
    bytes += len;
    i += cp > 0xffff ? 2 : 1;
  }
  out.push(text.slice(start));
  return out;
}

/** 一時的な DB の切断（Network connection lost 等）に備えて 1 回だけやり直す */
async function withOneRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (first) {
    await new Promise((r) => setTimeout(r, 300));
    try {
      return await fn();
    } catch {
      throw first;
    }
  }
}

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
  // 読み込みの失敗も SQL 全文・params を落としてから投げる（drizzle の DrizzleQueryError は message に SQL と params を含む）
  let row: EventRow | undefined;
  try {
    [row] = await db.select().from(whowatchEvents).where(eq(whowatchEvents.eventKey, eventKey)).limit(1);
  } catch (e) {
    throw new EventDetailSyncError("db", eventKey, describeDbError(e));
  }
  if (!opts.force && row && isDetailFresh(row, Date.now(), maxAge)) {
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
      // ITEM タブの key（無料イベントアイテムの分類用・0021）。ITEM タブが無いイベントは "" にして再取得しない
      itemGroupKey: detail.itemGroupKey ?? "",
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

    // 大きい列（struct / rules_text / rules_html）は別 UPDATE。失敗しても小さい列の保存は残す（参考情報なので警告扱い）。
    // 区分に要る struct（数 KB）を単独で先に保存し、長い本文の失敗に巻き込まない（2026-10-01 2026_10_magicfantasy の実害）。
    // どれも一時的な切断に備えて 1 回だけやり直す
    const warn = (label: string, e: unknown) => {
      const w = `${label} の保存に失敗: ${describeDbError(e)}`;
      dbWarning = dbWarning ? `${dbWarning} / ${w}` : w;
      console.warn("[event-detail-sync] large column failed", eventKey, w);
    };
    try {
      await withOneRetry(() =>
        db
          .update(whowatchEvents)
          .set({ struct: struct ? (sanitizeJson(struct) as Record<string, unknown>) : null })
          .where(eq(whowatchEvents.id, id)),
      );
    } catch (e) {
      warn("struct", e);
    }
    try {
      await writeLongText(db, id, "rulesText", rulesText ? sanitizeText(rulesText) : null);
    } catch (e) {
      warn("rules_text", e);
    }
    try {
      await writeLongText(db, id, "rulesHtml", rulesHtml ? slimHtml(rulesHtml) : null);
    } catch (e) {
      warn("rules_html", e);
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

/**
 * 長い本文（rules_text / rules_html）を DB_WRITE_CHUNK_BYTES ずつに分けて書く。1 つに収まれば UPDATE 1 回。
 * 分ける場合は 1 つのトランザクションで「1 つ目で置き換え → 残りを後ろに足す」。全体を 1 回だけやり直す
 * （1 つ目で置き換えるので、やり直しても本文は重複しない）
 */
async function writeLongText(db: Db, id: number, column: "rulesText" | "rulesHtml", text: string | null): Promise<void> {
  const value = (v: string | null) => (column === "rulesText" ? { rulesText: v } : { rulesHtml: v });
  const chunks = text === null ? [null] : splitUtf8ByBytes(text, DB_WRITE_CHUNK_BYTES);
  if (chunks.length === 1) {
    await withOneRetry(() => db.update(whowatchEvents).set(value(chunks[0])).where(eq(whowatchEvents.id, id)));
    return;
  }
  const col = column === "rulesText" ? whowatchEvents.rulesText : whowatchEvents.rulesHtml;
  await withOneRetry(() =>
    db.transaction(async (tx) => {
      await tx.update(whowatchEvents).set(value(chunks[0])).where(eq(whowatchEvents.id, id));
      for (const chunk of chunks.slice(1)) {
        await tx
          .update(whowatchEvents)
          .set(column === "rulesText" ? { rulesText: sql`coalesce(${col}, '') || ${chunk}` } : { rulesHtml: sql`coalesce(${col}, '') || ${chunk}` })
          .where(eq(whowatchEvents.id, id));
      }
    }),
  );
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
