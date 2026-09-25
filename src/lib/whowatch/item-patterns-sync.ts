// S1: アイテムマスタ（/playitems・認証不要・1969 件 / 4422 パターン）を whowatch_item_patterns に同期する。
// 価格は既存 item_point_mapping（/playitems/payments3 由来・日次同期済み）と item_id で結合する。
// 当たり判定は名前ベースの推定（whowatch-feed と同じ HIT_WORDS / GRADE_WORDS）。実ログで要確認。
//
// 2026-09-22 本番障害: 400 行 × 12 列 = 最大 4,800 bind パラメータの単一 INSERT が
// "Failed query: insert into whowatch_item_patterns ..." で失敗（HTTP 502）。
// PostgreSQL のバインドパラメータ上限（65,535）には遠く及ばないため Postgres 側の上限ではなく、
// Cloudflare Workers Free プランの CPU 時間 10ms/リクエスト（AGENTS.md）を、4,800 個の値を
// JS でシリアライズする処理が使い切った可能性が高いと推定（要確認）。
// 対策: 1 バッチを 200 行に半減し、event-detail-sync.ts と同じ cursor 方式で
// 1 リクエストあたりのバッチ数も制限する。1 バッチの失敗は他バッチを止めない。

import { sql } from "drizzle-orm";
import type { createDbClient } from "@/lib/db/client";
import { whowatchItemPatterns } from "@/lib/db/schema";
import { resolveWhowatchDeviceId } from "../platforms/whowatch";
import { describeDbError } from "./sanitize";

type Db = ReturnType<typeof createDbClient>;
const BASE_URL = "https://api.whowatch.tv";
const USER_AGENT = "TagDeck/0.1 (+https://tagdeck.jp)";

/** 1 INSERT あたりの行数。12 列 × 200 = 2,400 bind パラメータ（旧 400 行=4,800 から半減） */
export const ITEM_SYNC_CHUNK_SIZE = 200;
/** 1 リクエストで処理するチャンク数の既定値。DB 呼び出しは API 取得 1 + チャンク数(≦50) */
export const ITEM_SYNC_BATCH_LIMIT = 5;

const HIT_WORDS = ["あたり", "当たり", "当り", "アタリ", "大当", "ジャックポット", "JACKPOT"];
const GRADE_WORDS = ["ウルトラペタ", "ウルトラテラ", "ウルトラ", "ペタ", "テラ", "ギガ", "メガ", "ビッグ", "スーパー", "レギュラー", "小当たり", "中当たり", "大当たり", "小当り", "中当り", "大当り"];

interface RawPattern {
  id: number;
  name: string;
  quantity?: number;
  image_url?: string;
  animation_url2?: string;
  animation_fullscreen?: boolean;
  sound_url?: string;
}
interface RawItem {
  id: number;
  name: string;
  play_item_pattern?: RawPattern[];
}

export type PatternRow = typeof whowatchItemPatterns.$inferInsert;

export function estimateHit(item: { name: string; patternCount: number }, p: { name: string }): { isHit: boolean; grade: string | null; isVariant: boolean } {
  const grade = GRADE_WORDS.find((g) => p.name.includes(g) && !item.name.includes(g)) ?? null;
  for (const w of HIT_WORDS) if (p.name.includes(w) && !item.name.includes(w)) return { isHit: true, grade, isVariant: false };
  if (grade && p.name !== item.name && item.patternCount > 1 && /ボーナス|BONUS/i.test(item.name)) return { isHit: true, grade, isVariant: false };
  return { isHit: false, grade: null, isVariant: p.name !== item.name };
}

export async function fetchPlayItems(): Promise<RawItem[]> {
  const res = await fetch(`${BASE_URL}/playitems`, {
    headers: { "User-Agent": USER_AGENT, origin: "https://whowatch.tv", referer: "https://whowatch.tv/", Accept: "application/json", "x-whowatch-device-id": resolveWhowatchDeviceId() },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`playitems → HTTP ${res.status}`);
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) throw new Error("playitems: unexpected shape");
  return data as RawItem[];
}

export function flattenPatterns(items: RawItem[], now: Date): PatternRow[] {
  const rows: PatternRow[] = [];
  for (const item of items) {
    const pats = item.play_item_pattern ?? [];
    for (const p of pats) {
      const h = estimateHit({ name: item.name, patternCount: pats.length }, p);
      rows.push({
        patternId: p.id,
        itemId: item.id,
        itemName: item.name,
        patternName: p.name,
        quantity: typeof p.quantity === "number" ? p.quantity : null,
        isHit: h.isHit,
        hitGrade: h.grade,
        isVariant: h.isVariant,
        imageUrl: p.image_url ?? null,
        animationUrl: p.animation_url2 ?? null,
        animationFullscreen: p.animation_fullscreen === true,
        soundUrl: p.sound_url ?? null,
        syncedAt: now,
      });
    }
  }
  return rows;
}

/** rows を chunkSize ごとに分割する（最終チャンクは端数）。純関数・DB/ネットワーク非依存 */
export function chunkRows<T>(rows: T[], chunkSize: number): T[][] {
  const size = Math.max(1, chunkSize);
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export interface PlanItemBatchesOptions {
  chunkSize?: number;
  batchLimit?: number;
  /** 前回応答の next_cursor（pattern_id）。この値より大きい pattern_id から再開する */
  cursor?: string | null;
}
export interface PlanItemBatchesResult<T> {
  /** 今回の /playitems 取得分の総パターン数 */
  totalPatterns: number;
  /** 総チャンク数（cursor 起点ではなく全体） */
  totalChunks: number;
  /** このリクエストで処理するチャンク群（各チャンクは patternId 昇順） */
  batch: T[][];
  /** 次回リクエストに渡す cursor。もう続きが無ければ null */
  nextCursor: string | null;
}

/**
 * pattern_id 昇順に並べ、cursor より後ろから batchLimit 件のチャンクを切り出す。
 * /playitems は毎回取り直す前提（event-detail-sync の getEventLists() 使い回しと同じ設計）なので、
 * cursor は配列インデックスではなく安定な pattern_id を使う。
 */
export function planItemBatches<T extends { patternId: number }>(rows: T[], opts: PlanItemBatchesOptions = {}): PlanItemBatchesResult<T> {
  const chunkSize = Math.max(1, opts.chunkSize ?? ITEM_SYNC_CHUNK_SIZE);
  const batchLimit = Math.max(1, opts.batchLimit ?? ITEM_SYNC_BATCH_LIMIT);
  const sorted = [...rows].sort((a, b) => a.patternId - b.patternId);
  const cursorNum = opts.cursor != null && opts.cursor !== "" ? Number(opts.cursor) : null;
  const startIdx = cursorNum === null ? 0 : sorted.findIndex((r) => r.patternId > cursorNum);
  const remaining = startIdx < 0 ? [] : sorted.slice(startIdx);
  const allChunks = chunkRows(remaining, chunkSize);
  const batch = allChunks.slice(0, batchLimit);
  const hasMore = allChunks.length > batch.length;
  const lastChunk = batch[batch.length - 1];
  const nextCursor = hasMore && lastChunk && lastChunk.length > 0 ? String(lastChunk[lastChunk.length - 1].patternId) : null;
  return {
    totalPatterns: sorted.length,
    totalChunks: chunkRows(sorted, chunkSize).length,
    batch,
    nextCursor,
  };
}

export interface ChunkOutcome {
  range: string;
  rows: number;
  ok: boolean;
  inserted: number;
  updated: number;
  error?: string;
}

/** 1 チャンク分の upsert。xmax=0 trick で insert/update を判別する */
async function upsertChunk(db: Db, rows: PatternRow[]): Promise<{ inserted: number; updated: number }> {
  const res = await db
    .insert(whowatchItemPatterns)
    .values(rows)
    .onConflictDoUpdate({
      target: whowatchItemPatterns.patternId,
      set: {
        itemId: sql`excluded.item_id`,
        itemName: sql`excluded.item_name`,
        patternName: sql`excluded.pattern_name`,
        quantity: sql`excluded.quantity`,
        isHit: sql`excluded.is_hit`,
        hitGrade: sql`excluded.hit_grade`,
        isVariant: sql`excluded.is_variant`,
        imageUrl: sql`excluded.image_url`,
        animationUrl: sql`excluded.animation_url`,
        animationFullscreen: sql`excluded.animation_fullscreen`,
        soundUrl: sql`excluded.sound_url`,
        syncedAt: sql`excluded.synced_at`,
      },
    })
    .returning({ isInsert: sql<boolean>`(xmax = 0)` });
  const inserted = res.filter((r) => r.isInsert).length;
  return { inserted, updated: res.length - inserted };
}

export type SyncItemPatternsOptions = PlanItemBatchesOptions;

export interface SyncItemPatternsResult {
  ok: boolean;
  items: number;
  totalPatterns: number;
  totalChunks: number;
  /** このリクエストで処理した行数 */
  processed: number;
  inserted: number;
  updated: number;
  /** 失敗したチャンクの合計行数 */
  failed: number;
  chunks: number;
  /** 最初に失敗したチャンクのエラー（無ければ null）。SQL 全文・params は含まない */
  error: string | null;
  results: ChunkOutcome[];
  next_cursor: string | null;
}

/**
 * open/pre イベントの詳細同期（event-detail-sync.ts）と同じ設計:
 *   - /playitems は毎回取り直す（キャッシュしない。1,969 件・約 1.6MB で軽量）
 *   - pattern_id 昇順で 200 行ずつ upsert。1 リクエストで最大 batchLimit チャンクのみ処理し、
 *     残りは next_cursor で次回に回す（Workers のサブリクエスト上限対策）
 *   - 1 チャンクの失敗は他チャンクを止めない。エラーは describeDbError() で要約し、SQL 全文は出さない
 */
export async function syncItemPatterns(db: Db, opts: SyncItemPatternsOptions = {}): Promise<SyncItemPatternsResult> {
  const items = await fetchPlayItems();
  const now = new Date();
  const rows = flattenPatterns(items, now);
  const plan = planItemBatches(rows, opts);

  const results: ChunkOutcome[] = [];
  let inserted = 0;
  let updated = 0;
  let failed = 0;
  let firstError: string | null = null;

  for (const chunk of plan.batch) {
    const range = chunk.length > 0 ? `${chunk[0].patternId}-${chunk[chunk.length - 1].patternId}` : "empty";
    try {
      const r = await upsertChunk(db, chunk);
      inserted += r.inserted;
      updated += r.updated;
      results.push({ range, rows: chunk.length, ok: true, inserted: r.inserted, updated: r.updated });
    } catch (e) {
      const message = describeDbError(e);
      failed += chunk.length;
      if (firstError === null) firstError = message;
      results.push({ range, rows: chunk.length, ok: false, inserted: 0, updated: 0, error: message });
      console.error("[item-patterns-sync] chunk failed", range, message);
    }
  }

  return {
    ok: failed === 0,
    items: items.length,
    totalPatterns: plan.totalPatterns,
    totalChunks: plan.totalChunks,
    processed: plan.batch.reduce((s, c) => s + c.length, 0),
    inserted,
    updated,
    failed,
    chunks: plan.batch.length,
    error: firstError,
    results,
    next_cursor: plan.nextCursor,
  };
}
