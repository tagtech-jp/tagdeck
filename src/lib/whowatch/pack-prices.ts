// パックにしか入っていないアイテムの単価（2026-09-30 社長指示「パックにしか入っていないアイテムも単価を計算して組み込んでほしい」）。
//
// 背景: /playitems/payments3 には「買える商品」しか載らないため、パック限定のアイテム（ギンギラギンの 銀の風船・銀のKP・銀の神 等）は
// 単価が無く、無料配布（0 円）として扱われていた。パックの中身は商品説明の文字列にしか無い:
//   「ギンギラギンアイテムを詰め合わせたお得なパックです！<br>…<br>・銀の風船 x 10個<br>・銀のKP x 10個<br>…<br>※Web限定で「銀の貯金箱」のおまけ付き」
//
// 単価の決め方（whowatch_item_prices.unit_price_jpy と同じ「1 個あたりの定価（割引前）」）:
//   1. パックの割引前の価格 = Web の価格 + ラベルの割引額（「250円お得！」「アプリより100円お得！」。金額の無い「お得！」は 0）
//   2. 中身のうち単品で売っているアイテムは単品の定価のまま（行を作らない）
//   3. 単品で売っていない中身 = 割引前の価格から単品分を引いた残り ÷ その個数（中身が全部パック限定なら 割引前の価格 ÷ 個数）。
//      残りが 0 以下になるときは 割引前の価格 ÷ 全個数
//   4. 複数のパックに入っているときは 1 個あたりが高い方（割引の少ない方＝定価に近い方）
//   min_unit_price_jpy は Web の価格で割った実際の 1 個あたり
// 検証（2026-09-30 実データ）: 銀の通常アイテムパック Web ¥1,900・「アプリより100円お得！」→ ¥2,000 ÷ 40 個 = ¥50、
//   銀の文字アイテムパック ¥2,100 → ¥2,200 ÷ 20 個 = ¥110。イベントのランキング説明のスコア（銀の風船 25 点・銀の神 55 点）が
//   単品アイテム（隕石 ¥50 → 25 点、ダンスパーティ ¥5,000 → 2,500 点）と同じ「価格 ÷ 2」になり一致する
// おまけ（銀の貯金箱）は中身の行ではないので対象外（無料のまま）。

import { inArray } from "drizzle-orm";
import type { createDbClient } from "@/lib/db/client";
import { whowatchItemPatterns } from "@/lib/db/schema";
import type { ItemGroupRow, RawCategory } from "./item-groups-sync";
import { flattenPrices, type RawProduct } from "./item-prices";

type Db = ReturnType<typeof createDbClient>;

/** アイテム名の比較用（NFKC・空白をまとめる）。「銀のいいね！」と「銀のいいね!」、全角数字をそろえる */
export function normalizeItemName(s: string | null | undefined): string {
  return (s ?? "").normalize("NFKC").replace(/[ \t　]+/g, " ").trim();
}

export interface PackContent {
  /** 比較用に正規化した名前 */
  name: string;
  /** 説明文に書かれたままの名前（DB の item_name との照合用） */
  rawName: string;
  quantity: number;
}

const CONTENT_LINE = /^・\s*(.+?)\s*[x×✕]\s*(\d+)\s*個/;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** 商品説明（HTML・<br> 区切り）から「・アイテム名 x N個」の行を拾う。おまけの注記（※Web限定で「…」のおまけ付き）は拾わない */
export function parsePackContents(text: string | null | undefined): PackContent[] {
  if (!text) return [];
  const plain = decodeEntities(text.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""));
  const byName = new Map<string, PackContent>();
  for (const line of plain.split("\n")) {
    const m = CONTENT_LINE.exec(line.normalize("NFKC").replace(/[ \t　]+/g, " ").trim());
    if (!m) continue;
    const name = normalizeItemName(m[1]);
    const quantity = Number(m[2]);
    if (!name || !Number.isFinite(quantity) || quantity <= 0) continue;
    // 説明文に書かれたままの名前（NFKC 前）。行の「・」から「x/×」の手前まで
    const rawLine = line.replace(/[ \t　]+/g, " ").trim();
    const rawMatch = /^[・･]\s*(.+?)\s*[xXｘ×✕]\s*[\d０-９]+\s*個/.exec(rawLine);
    const rawName = rawMatch ? rawMatch[1].trim() : m[1].trim();
    const cur = byName.get(name);
    if (cur) cur.quantity += quantity;
    else byName.set(name, { name, rawName, quantity });
  }
  return [...byName.values()];
}

/** 割引前のパック価格。ラベル「250円お得！」「アプリより100円お得！」の金額を足し戻す（金額の無い「お得！」はそのまま） */
export function packListPrice(price: number, label: string | null | undefined): number {
  const m = /([\d,]+)\s*円\s*お得/.exec((label ?? "").normalize("NFKC"));
  const off = m ? Number(m[1].replace(/,/g, "")) : 0;
  return price + (Number.isFinite(off) && off > 0 ? off : 0);
}

export interface PackProduct {
  packItemId: number;
  packName: string;
  /** このパックが載っているカテゴリ key（中身もこのカテゴリに入れる） */
  groupKeys: string[];
  productId: string;
  /** Web の販売価格（1 セットあたり） */
  price: number;
  /** 割引前の価格（1 セットあたり） */
  listPrice: number;
  state: string;
  imageUrl: string | null;
  contents: PackContent[];
}

type RawPackItem = { id?: number; name?: string; image_url?: string; product_description?: string; play_item_payment_product?: Array<RawProduct & { decoration?: { description?: string; label?: string } | null; image_url?: string }> };

/** payments3 のカテゴリからパック（商品説明に中身の行があるアイテム）を集める（純関数）。同じパックは 1 つにまとめる */
export function collectPackProducts(categories: readonly RawCategory[]): PackProduct[] {
  const byId = new Map<number, PackProduct>();
  for (const c of categories) {
    const groupKey = typeof c.group === "string" ? c.group.trim() : "";
    for (const pi of (c.play_item ?? []) as RawPackItem[]) {
      if (typeof pi?.id !== "number") continue;
      const known = byId.get(pi.id);
      if (known) {
        if (groupKey && !known.groupKeys.includes(groupKey)) known.groupKeys.push(groupKey);
        continue;
      }
      const products = (pi.play_item_payment_product ?? []).filter((p) => typeof p?.price === "number" && p.price > 0);
      const candidates = products
        .map((p) => ({ p, contents: parsePackContents(p.decoration?.description || pi.product_description) }))
        .filter((x) => x.contents.length > 0);
      if (candidates.length === 0) continue;
      const open = candidates.filter((x) => (x.p.state || "OPEN") === "OPEN");
      const pool = open.length > 0 ? open : candidates;
      const qty = (p: RawProduct) => (typeof p.quantity === "number" && p.quantity > 0 ? Math.floor(p.quantity) : 1);
      // 1 セットあたりの価格が分かるよう、最小個数の商品（同数なら安い方）を使う
      const base = [...pool].sort((a, b) => qty(a.p) - qty(b.p) || (a.p.price ?? 0) - (b.p.price ?? 0))[0];
      const q = qty(base.p);
      byId.set(pi.id, {
        packItemId: pi.id,
        packName: typeof pi.name === "string" ? pi.name : "",
        groupKeys: groupKey ? [groupKey] : [],
        productId: typeof base.p.product_id === "string" && base.p.product_id ? base.p.product_id : String(base.p.id ?? ""),
        price: (base.p.price ?? 0) / q,
        listPrice: packListPrice(base.p.price ?? 0, base.p.decoration?.label) / q,
        state: typeof base.p.state === "string" && base.p.state ? base.p.state : "OPEN",
        imageUrl: typeof base.p.image_url === "string" ? base.p.image_url : typeof pi.image_url === "string" ? pi.image_url : null,
        contents: base.contents,
      });
    }
  }
  return [...byId.values()];
}

export interface ItemRef {
  itemId: number;
  itemName: string;
  imageUrl: string | null;
}

export interface PackPricedItem {
  itemId: number;
  itemName: string;
  /** 1 個あたりの定価（割引前）。SE のティア判定・OBS の単価表 */
  unitPriceJpy: number;
  /** 1 個あたりの実際の最安（Web のパック価格で割る） */
  minUnitPriceJpy: number;
  onSale: boolean;
  eventKey: string | null;
  pack: {
    itemId: number;
    name: string;
    productId: string;
    /** Web の価格（1 セット） */
    price: number;
    /** 割引前の価格（1 セット） */
    listPrice: number;
    /** パックの中身の全個数 */
    pieces: number;
    /** このアイテムの個数 */
    quantity: number;
    groupKeys: string[];
  };
}

export interface PackUnresolved {
  packName: string;
  name: string;
  reason: string;
}

export interface PackPriceInput {
  /** 単品で売っているアイテムの定価（正規化した名前 → 円） */
  knownUnitByName: ReadonlyMap<string, number>;
  /** マスタのアイテム（正規化した名前 → 候補） */
  refsByName: ReadonlyMap<string, readonly ItemRef[]>;
  /** 単品の価格があるアイテム（パックの中身として上書きしない） */
  pricedItemIds: ReadonlySet<number>;
}

/**
 * 画像 URL のイベントフォルダ（events/YYYY/MM_key/）→ イベントキー（YYYY_MM_key）。free-event-items.ts の eventKeyFromImageUrl と同じ規則
 * （あちらを読み込むと item-groups-sync → pack-prices → free-event-items → item-groups-sync の循環になるため写している）
 */
function eventFolder(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/events\/(\d{4})\/(\d{2}_[A-Za-z0-9_-]+)\//);
  return m ? `${m[1]}_${m[2]}` : null;
}

/** パック限定アイテムの単価を求める（純関数）。単品で売っている中身・マスタで見つからない中身には行を作らない */
export function computePackItemPrices(packs: readonly PackProduct[], input: PackPriceInput): { items: PackPricedItem[]; unresolved: PackUnresolved[] } {
  const best = new Map<number, { item: PackPricedItem; raw: number }>();
  const unresolved: PackUnresolved[] = [];
  for (const pack of packs) {
    const pieces = pack.contents.reduce((s, c) => s + c.quantity, 0);
    if (pieces <= 0 || pack.listPrice <= 0) continue;
    let knownTotal = 0;
    let unknownQty = 0;
    for (const c of pack.contents) {
      const u = input.knownUnitByName.get(c.name);
      if (u !== undefined) knownTotal += u * c.quantity;
      else unknownQty += c.quantity;
    }
    if (unknownQty === 0) continue; // 中身が全部単品で買える（ステージパック・季節パック等）
    const remainder = pack.listPrice - knownTotal;
    const unit = knownTotal > 0 && remainder > 0 ? remainder / unknownQty : knownTotal > 0 ? pack.listPrice / pieces : pack.listPrice / unknownQty;
    const minUnit = unit * (pack.price / pack.listPrice);
    const packFolder = eventFolder(pack.imageUrl);
    for (const c of pack.contents) {
      if (input.knownUnitByName.has(c.name)) continue;
      const refs = (input.refsByName.get(c.name) ?? []).filter((r) => !input.pricedItemIds.has(r.itemId));
      if (refs.length === 0) {
        unresolved.push({ packName: pack.packName, name: c.rawName, reason: "マスタに同じ名前のアイテムが無い" });
        continue;
      }
      // 同名が複数あるときはパックと同じイベントフォルダのものを優先（過去イベントの同名アイテムに付けない）
      const sameEvent = packFolder ? refs.filter((r) => eventFolder(r.imageUrl) === packFolder) : [];
      for (const r of sameEvent.length > 0 ? sameEvent : refs) {
        const item: PackPricedItem = {
          itemId: r.itemId,
          itemName: r.itemName,
          unitPriceJpy: Math.round(unit),
          minUnitPriceJpy: Math.round(minUnit),
          onSale: pack.state === "OPEN",
          eventKey: eventFolder(r.imageUrl) ?? packFolder,
          pack: { itemId: pack.packItemId, name: pack.packName, productId: pack.productId, price: pack.price, listPrice: pack.listPrice, pieces, quantity: c.quantity, groupKeys: [...pack.groupKeys] },
        };
        const cur = best.get(r.itemId);
        if (!cur || unit > cur.raw || (unit === cur.raw && pack.price < cur.item.pack.price)) best.set(r.itemId, { item, raw: unit });
      }
    }
  }
  return { items: [...best.values()].map((v) => v.item).sort((a, b) => a.itemId - b.itemId), unresolved };
}

/** パック限定アイテムを、パックと同じカテゴリの行にする（純関数）。見出し情報はパックの行から写す。既にある (item, group) は作らない */
export function packGroupRows(groupRows: readonly ItemGroupRow[], packItems: readonly PackPricedItem[], now: Date): ItemGroupRow[] {
  const byPair = new Map<string, ItemGroupRow>();
  for (const r of groupRows) byPair.set(`${r.itemId}|${r.groupKey}`, r);
  const out: ItemGroupRow[] = [];
  for (const it of packItems) {
    for (const groupKey of it.pack.groupKeys) {
      const template = byPair.get(`${it.pack.itemId}|${groupKey}`);
      const pair = `${it.itemId}|${groupKey}`;
      if (!template || byPair.has(pair)) continue;
      const row: ItemGroupRow = { ...template, itemId: it.itemId, eventKey: it.eventKey ?? template.eventKey ?? null, syncedAt: now };
      byPair.set(pair, row);
      out.push(row);
    }
  }
  return out;
}

/** マスタ（whowatch_item_patterns）から名前でアイテムを引く。キーは正規化した名前。イベントフォルダのある画像を優先して 1 枚持つ */
export async function loadItemRefsByName(db: Db, names: readonly string[]): Promise<Map<string, ItemRef[]>> {
  const out = new Map<string, ItemRef[]>();
  const uniq = [...new Set(names.filter(Boolean))];
  if (uniq.length === 0) return out;
  const rows = await db
    .select({ itemId: whowatchItemPatterns.itemId, itemName: whowatchItemPatterns.itemName, imageUrl: whowatchItemPatterns.imageUrl })
    .from(whowatchItemPatterns)
    .where(inArray(whowatchItemPatterns.itemName, uniq));
  const byId = new Map<number, ItemRef>();
  for (const r of rows) {
    const cur = byId.get(r.itemId);
    if (!cur) byId.set(r.itemId, { itemId: r.itemId, itemName: r.itemName, imageUrl: r.imageUrl });
    else if (!eventFolder(cur.imageUrl) && eventFolder(r.imageUrl)) cur.imageUrl = r.imageUrl;
  }
  for (const ref of byId.values()) {
    const key = normalizeItemName(ref.itemName);
    const list = out.get(key) ?? [];
    list.push(ref);
    out.set(key, list);
  }
  return out;
}

export interface ResolvedPackItems {
  packs: number;
  items: PackPricedItem[];
  unresolved: PackUnresolved[];
}

/** payments3 のカテゴリからパック限定アイテムの単価を求める（中身の名前はマスタ whowatch_item_patterns で引く） */
export async function resolvePackItems(db: Db, categories: readonly RawCategory[]): Promise<ResolvedPackItems> {
  const packs = collectPackProducts(categories);
  if (packs.length === 0) return { packs: 0, items: [], unresolved: [] };
  const packIds = new Set(packs.map((p) => p.packItemId));
  const single = flattenPrices(categories, new Date()).filter((r) => !packIds.has(r.itemId));
  const knownUnitByName = new Map(single.map((r) => [normalizeItemName(r.itemName), r.unitPriceJpy] as const));
  const pricedItemIds = new Set(single.map((r) => r.itemId));
  const names: string[] = [];
  for (const p of packs) for (const c of p.contents) if (!knownUnitByName.has(c.name)) names.push(c.rawName, c.name);
  const refsByName = names.length > 0 ? await loadItemRefsByName(db, names) : new Map<string, ItemRef[]>();
  return { packs: packs.length, ...computePackItemPrices(packs, { knownUnitByName, refsByName, pricedItemIds }) };
}
