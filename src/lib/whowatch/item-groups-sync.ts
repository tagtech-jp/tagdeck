// SE タブのアイテム仕分け 第2弾: ふわっちのアイテムページの見出し（カテゴリ）を whowatch_item_groups に同期する。
//
// 取得元は /playitems/payments3。group / title / display_order / badge_text はアイテム単位ではなく
// **カテゴリ単位**に付いている（2026-09-22 実応答で確認）。1 アイテムが複数カテゴリに同時所属する。
// 販売期間の日付は API に含まれない（画面の「2026/9/16〜9/30」はバナー画像側）。
//
// 注意: payments3 は**現在アクティブなカテゴリしか返さない**。終了したカテゴリは応答から消えるため、
// 過去の紐づけは遡って取得できない（whowatch_events の closed イベントと同じ制約）。

import { notInArray, sql } from "drizzle-orm";
import type { createDbClient } from "@/lib/db/client";
import { whowatchItemGroups } from "@/lib/db/schema";
import { resolveWhowatchDeviceId } from "../platforms/whowatch";

type Db = ReturnType<typeof createDbClient>;
const BASE_URL = "https://api.whowatch.tv";
const USER_AGENT = "TagDeck/0.1 (+https://tagdeck.jp)";

/**
 * payments3 のカテゴリ（必要なフィールドのみ）。
 * バナー画像・説明文のフィールド名は未確認（2026-09-25 時点。この環境から実応答を取れなかった）ため、
 * 候補キーを pickBannerUrl / pickDescription で総当たりし、無ければ null にする
 */
export interface RawCategory {
  group?: string;
  title?: string;
  sub_group_title?: string;
  badge_text?: string;
  display_order?: number;
  play_item?: Array<{ id?: number }>;
  [k: string]: unknown;
}

/** バナー画像 URL の候補キー（順に見て最初の http(s) URL を採用） */
const BANNER_KEYS = ["banner", "banner_url", "banner_image_url", "image_url", "image", "header_image_url", "thumbnail_url", "pc_banner_url", "sp_banner_url"] as const;
/** 説明文の候補キー */
const DESCRIPTION_KEYS = ["description", "sub_title", "subtitle", "lead", "note", "text"] as const;

/** http(s) の URL 文字列ならトリムして返す。それ以外は null */
function asHttpUrl(v: unknown): string | null {
  return typeof v === "string" && /^https?:\/\//i.test(v.trim()) ? v.trim() : null;
}

/** カテゴリからバナー画像 URL を拾う（純関数）。フィールド名が未確認なので候補を総当たり。無ければ null */
export function pickBannerUrl(c: RawCategory): string | null {
  for (const k of BANNER_KEYS) {
    const v: unknown = c[k];
    const direct = asHttpUrl(v);
    if (direct) return direct;
    // { url: "..." } / { pc: "...", sp: "..." } のような入れ子にも対応
    const nested: unknown[] = v && typeof v === "object" && !Array.isArray(v) ? Object.values(v as Record<string, unknown>) : [];
    for (const inner of nested) {
      const u = asHttpUrl(inner);
      if (u) return u;
    }
  }
  return null;
}

/** カテゴリの説明文を拾う（純関数）。空文字・URL は説明文とみなさない。長すぎる場合は 500 文字で切る */
export function pickDescription(c: RawCategory): string | null {
  for (const k of DESCRIPTION_KEYS) {
    const v = c[k];
    if (typeof v === "string" && v.trim() && !asHttpUrl(v)) return v.trim().slice(0, 500);
  }
  return null;
}

export type ItemGroupRow = typeof whowatchItemGroups.$inferInsert;

/**
 * payments3 のカテゴリ配列を (item_id, group_key) の行へ平坦化する。純関数。
 * - group が空のカテゴリは対象外
 * - 同一カテゴリ内で item_id が重複していても 1 行にまとめる（複合主キーの衝突を避ける）
 * - event_key は whowatch_events に実在する event_key のときだけ入れる（恒常カテゴリは null）
 */
export function flattenGroups(categories: RawCategory[], now: Date, knownEventKeys: ReadonlySet<string> = new Set()): ItemGroupRow[] {
  const seen = new Set<string>();
  const rows: ItemGroupRow[] = [];
  for (const c of categories) {
    const groupKey = typeof c.group === "string" ? c.group.trim() : "";
    if (!groupKey) continue;
    for (const pi of c.play_item ?? []) {
      const itemId = pi?.id;
      if (typeof itemId !== "number") continue;
      const dedupeKey = `${itemId}\u0000${groupKey}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      rows.push({
        itemId,
        groupKey,
        groupTitle: typeof c.title === "string" ? c.title : groupKey,
        subGroupTitle: typeof c.sub_group_title === "string" ? c.sub_group_title : null,
        badgeText: typeof c.badge_text === "string" ? c.badge_text : null,
        displayOrder: typeof c.display_order === "number" ? c.display_order : null,
        // group_key は event_lists の ITEM タブ detail と一致する（4/4 確認済み）。
        // ただし恒常カテゴリ（通常アイテム・ひとことアイテム等）はイベントではないので null のままにする
        eventKey: knownEventKeys.has(groupKey) ? groupKey : null,
        bannerUrl: pickBannerUrl(c),
        description: pickDescription(c),
        syncedAt: now,
      });
    }
  }
  return rows;
}

export async function fetchPaymentCategories(): Promise<RawCategory[]> {
  const res = await fetch(`${BASE_URL}/playitems/payments3`, {
    headers: { "User-Agent": USER_AGENT, origin: "https://whowatch.tv", referer: "https://whowatch.tv/", Accept: "application/json", "x-whowatch-device-id": resolveWhowatchDeviceId() },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`playitems/payments3 → HTTP ${res.status}`);
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) throw new Error("playitems/payments3: unexpected shape");
  return data as RawCategory[];
}

export interface SyncItemGroupsResult {
  categories: number;
  rows: number;
  inserted: number;
  updated: number;
  /** 今回の応答に無くなったため削除した行数（終了したカテゴリの掃除） */
  deleted: number;
}

/**
 * カテゴリを取得して whowatch_item_groups を全置換する。
 * 行数は 100 件前後と小さいので、アイテムパターン同期のようなチャンク分割は不要。
 * 応答から消えたカテゴリの行は削除する（終了したセールが残り続けないように）。
 */
export async function syncItemGroups(db: Db, preloaded?: RawCategory[]): Promise<SyncItemGroupsResult> {
  // 単価同期（item-prices.ts）と同じ応答を使い回せるよう、取得済みのカテゴリを受け取れる
  const categories = preloaded ?? (await fetchPaymentCategories());
  const rows = flattenGroups(categories, new Date());
  if (rows.length === 0) {
    // 応答が空のときに全削除すると事故になるので、掃除はしない
    return { categories: categories.length, rows: 0, inserted: 0, updated: 0, deleted: 0 };
  }

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
        syncedAt: sql`excluded.synced_at`,
      },
    })
    .returning({ isInsert: sql<boolean>`(xmax = 0)` });
  const inserted = res.filter((r) => r.isInsert).length;

  // 今回の応答に無くなったカテゴリの行を消す（終了したセールが残り続けないように）。
  // sql`... not in ${配列}` は配列を単一パラメータとして埋め込むため不正な SQL になる。
  // notInArray() を使うこと（2026-09-23 に同期が黙って失敗していた原因）
  const groupKeys = [...new Set(rows.map((r) => r.groupKey))];
  const deletedRows = await db
    .delete(whowatchItemGroups)
    .where(notInArray(whowatchItemGroups.groupKey, groupKeys))
    .returning({ itemId: whowatchItemGroups.itemId });

  return { categories: categories.length, rows: rows.length, inserted, updated: res.length - inserted, deleted: deletedRows.length };
}
