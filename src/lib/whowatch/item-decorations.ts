// まとめ投げの段階しきい値（pattern_decorations）を whowatch_item_decorations に同期する（2026-09-28）。
//
// 取得元: GET /lives/{id}/playitems3（認証不要・2026-09-28 実応答で確認）。配信 1 本を指定して呼ぶと、その配信で使える
// アイテム（≒ 現行カタログ 88 件）が user_retain_items に並び、各アイテムの patterns[0] に
//   pattern_decorations: [{count, pattern_decoration: "COOL" | "GREAT" | "FANTASTIC" | "MIRACLE" | …}]
// が入る。/playitems（マスタ）にはこのフィールドが無い。配信 ID は /lives2（配信中一覧）の先頭を使う。
// 認証なしで載るのは購入できるアイテム（実測 88 件・うち 86 件にしきい値。無いのは投票券・サイコロ）。
// イベントの無料配布（バスケット・どんぐり等）は載らないが pattern_limit=3 なので段階が付くことはない。
// 判定ロジックはブラウザと共有するため se/bulk-grade.ts に置き、ここは取得と保存だけ。

import { sql } from "drizzle-orm";
import type { createDbClient } from "@/lib/db/client";
import { whowatchItemDecorations } from "@/lib/db/schema";
import { resolveWhowatchDeviceId } from "../platforms/whowatch";
import { parseDecorations } from "../se/bulk-grade";

type Db = ReturnType<typeof createDbClient>;
const BASE_URL = "https://api.whowatch.tv";
const USER_AGENT = "TagDeck/0.1 (+https://tagdeck.jp)";

function headers(): Record<string, string> {
  return { "User-Agent": USER_AGENT, origin: "https://whowatch.tv", referer: "https://whowatch.tv/", Accept: "application/json", "x-whowatch-device-id": resolveWhowatchDeviceId() };
}

export interface RawPlayItems3Pattern {
  play_item_pattern_id?: number;
  name?: string;
  pattern_limit?: number;
  pattern_decorations?: unknown;
  custom_pattern_decorations?: unknown;
}
export interface RawPlayItems3Item {
  play_item_id?: number;
  patterns?: RawPlayItems3Pattern[];
}

/** /lives2 の応答（配列、または {lives: [...]}）から配信 ID を 1 つ選ぶ。無ければ null */
export function pickLiveId(list: unknown): number | null {
  const arr = Array.isArray(list) ? list : list && typeof list === "object" && Array.isArray((list as { lives?: unknown }).lives) ? (list as { lives: unknown[] }).lives : [];
  for (const l of arr) {
    const id = l && typeof l === "object" ? (l as { id?: unknown }).id : undefined;
    if (typeof id === "number" && id > 0) return id;
  }
  return null;
}

export type ItemDecorationRow = typeof whowatchItemDecorations.$inferInsert;

/** playitems3 の user_retain_items をアイテムごとの行にする（純関数）。段階の無いアイテムも行にする（「しきい値なし」を記録するため） */
export function flattenDecorations(items: readonly RawPlayItems3Item[], now: Date): ItemDecorationRow[] {
  const rows: ItemDecorationRow[] = [];
  const seen = new Set<number>();
  for (const it of items) {
    if (typeof it?.play_item_id !== "number" || seen.has(it.play_item_id)) continue;
    seen.add(it.play_item_id);
    const p0 = it.patterns?.[0];
    rows.push({
      itemId: it.play_item_id,
      itemName: typeof p0?.name === "string" ? p0.name : "",
      decorations: parseDecorations(p0?.pattern_decorations),
      patternLimit: typeof p0?.pattern_limit === "number" ? p0.pattern_limit : null,
      syncedAt: now,
    });
  }
  return rows;
}

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: headers(), signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (!res.ok) throw new Error(`whowatch ${path} → HTTP ${res.status}`);
  return res.json();
}

/** 配信中の一覧から 1 本選び、その playitems3 を取る */
export async function fetchLiveItemDecorations(): Promise<{ liveId: number; items: RawPlayItems3Item[] }> {
  let liveId: number | null = null;
  for (const path of ["/lives2?category_id=152", "/lives2"]) {
    try {
      liveId = pickLiveId(await getJson(path));
    } catch {
      liveId = null;
    }
    if (liveId) break;
  }
  if (!liveId) throw new Error("playitems3: 配信中の配信が見つからないため取得できない（/lives2 が空）");
  const d = (await getJson(`/lives/${liveId}/playitems3`)) as { user_retain_items?: unknown };
  const items = Array.isArray(d?.user_retain_items) ? (d.user_retain_items as RawPlayItems3Item[]) : [];
  if (items.length === 0) throw new Error(`playitems3: live ${liveId} の user_retain_items が空`);
  return { liveId, items };
}

export interface SyncItemDecorationsResult {
  liveId: number | null;
  rows: number;
  withGrades: number;
  inserted: number;
  updated: number;
}

/** しきい値行を upsert する（100 行前後）。応答から消えたアイテムの行は残す（過去のしきい値で判定できるように） */
export async function syncItemDecorations(db: Db): Promise<SyncItemDecorationsResult> {
  const { liveId, items } = await fetchLiveItemDecorations();
  const rows = flattenDecorations(items, new Date());
  if (rows.length === 0) return { liveId, rows: 0, withGrades: 0, inserted: 0, updated: 0 };
  const res = await db
    .insert(whowatchItemDecorations)
    .values(rows)
    .onConflictDoUpdate({
      target: whowatchItemDecorations.itemId,
      set: { itemName: sql`excluded.item_name`, decorations: sql`excluded.decorations`, patternLimit: sql`excluded.pattern_limit`, syncedAt: sql`excluded.synced_at` },
    })
    .returning({ isInsert: sql<boolean>`(xmax = 0)` });
  const inserted = res.filter((r) => r.isInsert).length;
  return { liveId, rows: rows.length, withGrades: rows.filter((r) => (r.decorations?.length ?? 0) > 0).length, inserted, updated: res.length - inserted };
}
