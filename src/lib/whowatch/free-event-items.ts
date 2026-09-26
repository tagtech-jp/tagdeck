// イベントの無料配布アイテム（どんぐり・赤ずきんサイコロ・ルーキーフラッグ等）をイベントのカテゴリに分類する（2026-09-26）。
//
// 背景（社長指示「イベントの無料もカテゴリーに分類してほしい」）: /playitems/payments3 のカテゴリには**買える**アイテムしか
// 載らないため、イベントで配られる無料アイテムは「分類なし」に落ちていた。
// 手がかり（2026-09-26 実応答で確認）:
//   - アイテム画像の URL にイベントのフォルダが入る: img.whowatch.tv/events/2026/09_autumncollection/item_meter_omake.png
//     → イベントキー 2026_09_autumncollection（"YYYY/MM_key" → "YYYY_MM_key"）
//   - イベント詳細（/event_lists/{key}）の ITEM タブの detail が payments3 のカテゴリ key と一致する
//     （autumncollection / autumncollectionlite → "autumncollection"、2026_09_gingiragin → "gingiragin_2026"）
// 手順: 無料（単価テーブルに無い）× 画像がイベントフォルダ × そのイベントの ITEM タブ key がカテゴリに存在 → whowatch_item_groups に is_free=true で追加

import { and, eq, like, or, sql } from "drizzle-orm";
import type { createDbClient } from "@/lib/db/client";
import { whowatchEvents, whowatchItemGroups, whowatchItemPatterns, whowatchItemPrices } from "@/lib/db/schema";
import { getEventDetail } from "./events";
import { flattenGroups, type ItemGroupRow, type RawCategory } from "./item-groups-sync";

type Db = ReturnType<typeof createDbClient>;

/** 画像 URL のイベントフォルダ（events/YYYY/MM_key/）からイベントキーを作る。無ければ null */
export function eventKeyFromImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/events\/(\d{4})\/(\d{2}_[A-Za-z0-9_-]+)\//);
  return m ? `${m[1]}_${m[2]}` : null;
}

export interface FreeItemInput {
  /** whowatch_item_patterns の (item_id, image_url)。同じ item の複数パターンを含んでよい */
  patterns: ReadonlyArray<{ itemId: number; imageUrl: string | null }>;
  /** 単価がある（＝買える）アイテム。無料判定に使う */
  pricedItemIds: ReadonlySet<number>;
  /** event_key → ITEM タブのカテゴリ key */
  eventGroupByKey: ReadonlyMap<string, string>;
  /** 今回の payments3 カテゴリ */
  categories: readonly RawCategory[];
}

/** 無料イベントアイテムの whowatch_item_groups 行を作る（純関数）。カテゴリの見出し情報は payments3 の行から写す */
export function buildFreeItemGroupRows(input: FreeItemInput, now: Date): ItemGroupRow[] {
  // カテゴリ key → 見出し情報（flattenGroups の 1 行目から取る）
  const template = new Map<string, ItemGroupRow>();
  const paidRows = flattenGroups([...input.categories], now);
  for (const r of paidRows) if (!template.has(r.groupKey)) template.set(r.groupKey, r);
  // 有料アイテムが既に属する (item, group) は無料扱いにしない
  const paidPairs = new Set(paidRows.map((r) => `${r.itemId}|${r.groupKey}`));

  const out: ItemGroupRow[] = [];
  const seen = new Set<string>();
  for (const p of input.patterns) {
    if (input.pricedItemIds.has(p.itemId)) continue;
    const eventKey = eventKeyFromImageUrl(p.imageUrl);
    if (!eventKey) continue;
    const groupKey = input.eventGroupByKey.get(eventKey);
    if (!groupKey) continue;
    const t = template.get(groupKey);
    if (!t) continue; // 終了したカテゴリ（payments3 に無い）には付けない
    const pair = `${p.itemId}|${groupKey}`;
    if (paidPairs.has(pair) || seen.has(pair)) continue;
    seen.add(pair);
    out.push({ ...t, itemId: p.itemId, eventKey, isFree: true, syncedAt: now });
  }
  return out;
}

export interface SyncFreeEventItemsResult {
  eventsResolved: number;
  eventsFetched: number;
  rows: number;
  inserted: number;
  updated: number;
  deleted: number;
}

/** 1 回の同期で ITEM タブ key を取りに行くイベント数の上限（Workers のサブリクエスト上限を守る） */
const MAX_EVENT_DETAIL_FETCHES = 20;

/**
 * 無料イベントアイテムをカテゴリに紐づける。
 * 1) open/pre のイベントで item_group_key が未取得なら /event_lists/{key} から ITEM タブの key を取って保存（上限 20 件）
 * 2) 単価テーブルに無いアイテムのうち、画像がイベントフォルダのものを、そのイベントのカテゴリへ is_free=true で upsert
 * 3) 今回作らなかった is_free 行は削除（有料化・イベント終了の掃除）
 */
export async function syncFreeEventItems(db: Db, categories: readonly RawCategory[]): Promise<SyncFreeEventItemsResult> {
  const now = new Date();
  const events = await db
    .select({ eventKey: whowatchEvents.eventKey, itemGroupKey: whowatchEvents.itemGroupKey, status: whowatchEvents.status })
    .from(whowatchEvents);
  const eventGroupByKey = new Map<string, string>();
  for (const e of events) if (e.itemGroupKey) eventGroupByKey.set(e.eventKey, e.itemGroupKey);

  // 未取得の open/pre イベントだけ詳細を取りに行く（一度取れば以後は DB から）
  let fetched = 0;
  const missing = events.filter((e) => !e.itemGroupKey && (e.status === "open" || e.status === "pre")).slice(0, MAX_EVENT_DETAIL_FETCHES);
  for (const e of missing) {
    try {
      const d = await getEventDetail(e.eventKey);
      fetched++;
      const key = d.itemGroupKey ?? "";
      // 取れなかったイベントは "" を入れて次回も取りに行かない（ITEM タブが無いイベント）
      await db.update(whowatchEvents).set({ itemGroupKey: key }).where(eq(whowatchEvents.eventKey, e.eventKey));
      if (key) eventGroupByKey.set(e.eventKey, key);
    } catch (err) {
      console.warn("[free-event-items] event detail failed", e.eventKey, err instanceof Error ? err.message : String(err));
    }
  }

  const [patterns, priced] = await Promise.all([
    db
      .select({ itemId: whowatchItemPatterns.itemId, imageUrl: whowatchItemPatterns.imageUrl })
      .from(whowatchItemPatterns)
      .where(like(whowatchItemPatterns.imageUrl, "%/events/%")),
    db.select({ itemId: whowatchItemPrices.itemId }).from(whowatchItemPrices),
  ]);
  const rows = buildFreeItemGroupRows({ patterns, pricedItemIds: new Set(priced.map((p) => p.itemId)), eventGroupByKey, categories }, now);

  let inserted = 0;
  let updated = 0;
  if (rows.length > 0) {
    const res = await db
      .insert(whowatchItemGroups)
      .values(rows)
      .onConflictDoUpdate({
        target: [whowatchItemGroups.itemId, whowatchItemGroups.groupKey],
        set: {
          groupTitle: sql`excluded.group_title`,
          subGroupTitle: sql`excluded.sub_group_title`,
          badgeText: sql`excluded.badge_text`,
          displayOrder: sql`excluded.display_order`,
          eventKey: sql`excluded.event_key`,
          bannerUrl: sql`excluded.banner_url`,
          description: sql`excluded.description`,
          isFree: sql`excluded.is_free`,
          syncedAt: sql`excluded.synced_at`,
        },
      })
      .returning({ isInsert: sql<boolean>`(xmax = 0)` });
    inserted = res.filter((r) => r.isInsert).length;
    updated = res.length - inserted;
  }

  // 今回作らなかった無料行を掃除（有料化・イベント終了・画像パス変更）
  const existingFree = await db
    .select({ itemId: whowatchItemGroups.itemId, groupKey: whowatchItemGroups.groupKey })
    .from(whowatchItemGroups)
    .where(eq(whowatchItemGroups.isFree, true));
  const keep = new Set(rows.map((r) => `${r.itemId}|${r.groupKey}`));
  const stale = existingFree.filter((r) => !keep.has(`${r.itemId}|${r.groupKey}`));
  let deleted = 0;
  if (stale.length > 0) {
    // (item_id, group_key) の組を正確に消す（無料行は数十件なので OR で足りる）
    const pairs = stale.map((r) => and(eq(whowatchItemGroups.itemId, r.itemId), eq(whowatchItemGroups.groupKey, r.groupKey)));
    const d = await db
      .delete(whowatchItemGroups)
      .where(and(eq(whowatchItemGroups.isFree, true), or(...pairs)))
      .returning({ itemId: whowatchItemGroups.itemId });
    deleted = d.length;
  }

  return { eventsResolved: eventGroupByKey.size, eventsFetched: fetched, rows: rows.length, inserted, updated, deleted };
}
