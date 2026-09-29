// アイテムの「1 個あたりの単価」を /playitems/payments3 から求めて whowatch_item_prices に同期する（2026-09-26）。
//
// 背景（社長報告「単価取得が曖昧」）: item_point_mapping.price_jpy は Python の日次同期が
// **最初の商品の価格**をそのまま入れており、商品が「1 個 ¥160 / 5 個 ¥800 / 10 個 ¥1,580 …」と複数ある
// アイテム（86/111 件）で「どの商品の価格か」が曖昧だった。さらに「スター」のように最小商品が 3 個 ¥90 の
// アイテムは 1 個 ¥30 なのに ¥90 が単価として扱われていた。
//
// 定義:
//   unit_price_jpy     = 最小個数の商品（通常 1 個入り）の price ÷ quantity（定価の単価）。SE のティア判定はこれ × 個数
//   min_unit_price_jpy = 全商品のうち最も安い 1 個あたり（まとめ買いの割引後）。表示・参考用
//   products           = 商品ごとの {productId, price, quantity, state}（SE タブで価格表を出せるように）
// 対象は state=OPEN の商品。OPEN が無ければ全商品から求め、on_sale=false にする
// パックにしか入っていないアイテム（銀の風船 等・2026-09-30）は pack-prices.ts が「割引前のパック価格 ÷ 個数」で求め、
// products に pack（パック名・割引前の価格・全個数）付きの 1 件を入れて同じテーブルに書く

import { sql } from "drizzle-orm";
import type { createDbClient } from "@/lib/db/client";
import { whowatchItemPrices } from "@/lib/db/schema";
import type { RawCategory } from "./item-groups-sync";
import type { PackPricedItem } from "./pack-prices";

type Db = ReturnType<typeof createDbClient>;

export interface RawProduct {
  id?: number;
  price?: number;
  quantity?: number;
  state?: string;
  product_id?: string;
  available?: boolean;
}

export interface PriceProduct {
  productId: string;
  price: number;
  quantity: number;
  state: string;
  /** パック限定アイテムの単価の元（2026-09-30）。price はパックの Web 価格、quantity はパックに入っているこのアイテムの個数 */
  pack?: { itemId: number; name: string; listPrice: number; pieces: number };
}

export interface UnitPrice {
  unitPriceJpy: number;
  minUnitPriceJpy: number;
  onSale: boolean;
  products: PriceProduct[];
}

/** 商品配列から単価を求める（純関数）。商品が無い・価格が全部 0 なら null（無料・価格なし） */
export function unitPriceFromProducts(raw: readonly RawProduct[] | null | undefined): UnitPrice | null {
  const products: PriceProduct[] = [];
  const seen = new Set<string>();
  for (const p of raw ?? []) {
    const price = typeof p.price === "number" && Number.isFinite(p.price) ? p.price : 0;
    const quantity = typeof p.quantity === "number" && p.quantity > 0 ? Math.floor(p.quantity) : 1;
    const productId = typeof p.product_id === "string" && p.product_id ? p.product_id : String(p.id ?? "");
    const key = `${productId}|${price}|${quantity}`;
    if (seen.has(key)) continue; // 同じアイテムが複数カテゴリに出るため商品も重複する
    seen.add(key);
    products.push({ productId, price, quantity, state: typeof p.state === "string" ? p.state : "OPEN" });
  }
  const priced = products.filter((p) => p.price > 0);
  if (priced.length === 0) return null;
  const open = priced.filter((p) => p.state === "OPEN");
  const pool = open.length > 0 ? open : priced;
  // 定価の単価 = 最小個数の商品（同数なら安い方）
  const base = [...pool].sort((a, b) => a.quantity - b.quantity || a.price - b.price)[0];
  const unitPriceJpy = Math.round(base.price / base.quantity);
  const minUnitPriceJpy = Math.round(Math.min(...pool.map((p) => p.price / p.quantity)));
  return { unitPriceJpy, minUnitPriceJpy, onSale: open.length > 0, products: products.sort((a, b) => a.quantity - b.quantity) };
}

export type ItemPriceRow = typeof whowatchItemPrices.$inferInsert;

/** payments3 のカテゴリ配列からアイテムごとの単価行を作る（純関数）。同じアイテムは 1 行にまとめる */
export function flattenPrices(categories: readonly RawCategory[], now: Date): ItemPriceRow[] {
  const byItem = new Map<number, { name: string; products: RawProduct[] }>();
  for (const c of categories) {
    for (const pi of (c.play_item ?? []) as Array<{ id?: number; name?: string; play_item_payment_product?: RawProduct[] }>) {
      if (typeof pi?.id !== "number") continue;
      const cur = byItem.get(pi.id) ?? { name: typeof pi.name === "string" ? pi.name : "", products: [] };
      cur.products.push(...(pi.play_item_payment_product ?? []));
      byItem.set(pi.id, cur);
    }
  }
  const rows: ItemPriceRow[] = [];
  for (const [itemId, v] of byItem) {
    const u = unitPriceFromProducts(v.products);
    if (!u) continue; // 価格の無いアイテムは行を作らない（priceJpy=null 扱いのまま）
    rows.push({ itemId, itemName: v.name, unitPriceJpy: u.unitPriceJpy, minUnitPriceJpy: u.minUnitPriceJpy, onSale: u.onSale, products: u.products, syncedAt: now });
  }
  return rows;
}

export interface SyncItemPricesResult {
  rows: number;
  inserted: number;
  updated: number;
  /** うちパックの価格から求めた行（パック限定アイテム） */
  fromPacks?: number;
}

/** パック限定アイテムの単価行（純関数）。単品の価格がある行は上書きしない */
export function packPriceRows(packItems: readonly PackPricedItem[], existing: ReadonlySet<number>, now: Date): ItemPriceRow[] {
  return packItems
    .filter((p) => !existing.has(p.itemId))
    .map((p) => ({
      itemId: p.itemId,
      itemName: p.itemName,
      unitPriceJpy: p.unitPriceJpy,
      minUnitPriceJpy: p.minUnitPriceJpy,
      onSale: p.onSale,
      products: [{ productId: p.pack.productId, price: p.pack.price, quantity: p.pack.quantity, state: p.onSale ? "OPEN" : "CLOSED", pack: { itemId: p.pack.itemId, name: p.pack.name, listPrice: p.pack.listPrice, pieces: p.pack.pieces } }],
      syncedAt: now,
    }));
}

/**
 * 単価行を upsert する（100 行前後）。応答から消えたアイテムの行は残す（過去ギフトの金額表示に使うため）。
 * packItems（pack-prices.ts の resolvePackItems）があればパック限定アイテムの行も書く
 */
export async function syncItemPrices(db: Db, categories: readonly RawCategory[], packItems: readonly PackPricedItem[] = []): Promise<SyncItemPricesResult> {
  const now = new Date();
  const single = flattenPrices(categories, now);
  const fromPacks = packPriceRows(packItems, new Set(single.map((r) => r.itemId)), now);
  const rows = [...single, ...fromPacks];
  if (rows.length === 0) return { rows: 0, inserted: 0, updated: 0, fromPacks: 0 };
  const res = await db
    .insert(whowatchItemPrices)
    .values(rows)
    .onConflictDoUpdate({
      target: whowatchItemPrices.itemId,
      set: {
        itemName: sql`excluded.item_name`,
        unitPriceJpy: sql`excluded.unit_price_jpy`,
        minUnitPriceJpy: sql`excluded.min_unit_price_jpy`,
        onSale: sql`excluded.on_sale`,
        products: sql`excluded.products`,
        syncedAt: sql`excluded.synced_at`,
      },
    })
    .returning({ isInsert: sql<boolean>`(xmax = 0)` });
  const inserted = res.filter((r) => r.isInsert).length;
  return { rows: rows.length, inserted, updated: res.length - inserted, fromPacks: fromPacks.length };
}

/**
 * 1 回のコメントの合計金額（単価 × 個数）。まとめ投げは合計で判定する（社長指示 2026-09-26）。
 * 個数はコメントの item_count × パターンの quantity（「風船 × 10」のような束パターン）
 */
export function giftTotalYen(unitPriceYen: number | null, count: number): number {
  return Math.max(0, unitPriceYen ?? 0) * Math.max(1, count);
}
