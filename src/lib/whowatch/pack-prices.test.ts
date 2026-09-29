import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ItemGroupRow, RawCategory } from "./item-groups-sync";
import { flattenPrices, packPriceRows } from "./item-prices";
import { collectPackProducts, computePackItemPrices, normalizeItemName, packGroupRows, packListPrice, parsePackContents, type ItemRef, type PackProduct } from "./pack-prices";

// 2026-09-30 の /playitems/payments3 実応答から、パック 7 個と中身の単品アイテムだけを抜き出したもの
const CATEGORIES = JSON.parse(readFileSync(path.join(__dirname, "__fixtures__", "payments3_packs_20260930.json"), "utf8")) as RawCategory[];

// マスタ（/playitems）の パック限定アイテム。payments3 には載らない
const IMG = (f: string) => `https://img.whowatch.tv/events/2026/09_gingiragin/${f}`;
const SILVER: ItemRef[] = [
  { itemId: 13066, itemName: "銀の風船", imageUrl: IMG("item_silver-balloon_anim.webp") },
  { itemId: 13067, itemName: "銀のいいね！", imageUrl: IMG("item_silver-iine_anim.webp") },
  { itemId: 13068, itemName: "銀のKP", imageUrl: IMG("item_silver-kp_anim.webp") },
  { itemId: 13069, itemName: "銀のハート", imageUrl: IMG("item_silver-heart_anim.webp") },
  { itemId: 13070, itemName: "銀の神", imageUrl: IMG("item_silver-kami_anim.webp") },
  { itemId: 13071, itemName: "銀のえ？", imageUrl: IMG("item_silver-e_anim.webp") },
  { itemId: 13072, itemName: "銀の草", imageUrl: IMG("item_silver-kusa_anim.webp") },
  { itemId: 13073, itemName: "銀のかわいい", imageUrl: IMG("item_silver-kawaii_anim.webp") },
];
const refsOf = (refs: readonly ItemRef[]) => {
  const m = new Map<string, ItemRef[]>();
  for (const r of refs) m.set(normalizeItemName(r.itemName), [...(m.get(normalizeItemName(r.itemName)) ?? []), r]);
  return m;
};

function inputFromFixture() {
  const packs = collectPackProducts(CATEGORIES);
  const packIds = new Set(packs.map((p) => p.packItemId));
  const single = flattenPrices(CATEGORIES, new Date("2026-09-30T00:00:00Z")).filter((r) => !packIds.has(r.itemId));
  return {
    packs,
    input: {
      knownUnitByName: new Map(single.map((r) => [normalizeItemName(r.itemName), r.unitPriceJpy] as const)),
      refsByName: refsOf(SILVER),
      pricedItemIds: new Set(single.map((r) => r.itemId)),
    },
  };
}

describe("parsePackContents（商品説明の「・名前 x N個」）", () => {
  it("実データの説明文から中身を拾い、おまけの注記は拾わない", () => {
    const text = "銀色になった通常アイテムを詰め合わせたアイテムパックです！<br>購入すると下記のアイテムが付与されます。<br><br>・銀の風船 x 10個<br>・銀のいいね！ x 10個<br>・銀のKP x 10個<br>・銀のハート x 10個<br>※Web限定で「銀の貯金箱」のおまけ付き（有効期限：2026年10月31日）";
    expect(parsePackContents(text)).toEqual([
      { name: "銀の風船", rawName: "銀の風船", quantity: 10 },
      { name: "銀のいいね!", rawName: "銀のいいね！", quantity: 10 },
      { name: "銀のKP", rawName: "銀のKP", quantity: 10 },
      { name: "銀のハート", rawName: "銀のハート", quantity: 10 },
    ]);
  });

  it("全角の数字・×・空白なし・同じ名前の 2 行は合計", () => {
    expect(parsePackContents("・月見ハンバーガーx３個<br>・秋のさつまいもタルト × 2個<br>・月見ハンバーガー x 1個")).toEqual([
      { name: "月見ハンバーガー", rawName: "月見ハンバーガー", quantity: 4 },
      { name: "秋のさつまいもタルト", rawName: "秋のさつまいもタルト", quantity: 2 },
    ]);
    expect(parsePackContents(null)).toEqual([]);
    expect(parsePackContents("普通のアイテムです")).toEqual([]);
  });
});

describe("packListPrice（割引前のパック価格）", () => {
  it("ラベルの割引額を足し戻す。金額の無い「お得！」はそのまま", () => {
    expect(packListPrice(1900, "250円お得！")).toBe(2150);
    expect(packListPrice(10500, "1,750円お得！")).toBe(12250);
    expect(packListPrice(1900, "アプリより100円お得！")).toBe(2000);
    expect(packListPrice(100, "お得！")).toBe(100);
    expect(packListPrice(500, "３０円お得！")).toBe(530);
    expect(packListPrice(500, null)).toBe(500);
  });
});

describe("collectPackProducts（実データ）", () => {
  it("パック 7 個をまとめ、複数カテゴリに載るパックはカテゴリを全部持つ", () => {
    const packs = collectPackProducts(CATEGORIES);
    expect(packs.map((p) => p.packItemId).sort()).toEqual([11553, 12891, 12943, 13077, 13078, 13079, 13080]);
    const silver = packs.find((p) => p.packItemId === 13078)!;
    expect(silver).toMatchObject({ packName: "銀の通常アイテムパック", price: 1900, listPrice: 2000, state: "OPEN" });
    expect(silver.groupKeys).toEqual(["gingiragin_2026"]);
    expect(silver.contents.map((c) => [c.name, c.quantity])).toEqual([["銀の風船", 10], ["銀のいいね!", 10], ["銀のKP", 10], ["銀のハート", 10]]);
    const mini = packs.find((p) => p.packItemId === 13077)!;
    expect(mini).toMatchObject({ price: 1900, listPrice: 2150 });
    expect(mini.groupKeys.sort()).toEqual(["gingiragin_2026", "monthly_item_pack"]);
    // 割引前の価格は単品の合計と一致する（隕石 50×4 + 流星群 150×3 + ねこさん 250×2 + オーロラ 1,000×1 = 2,150）
    const deluxe = packs.find((p) => p.packItemId === 13080)!;
    expect(deluxe.listPrice).toBe(12250);
  });
});

describe("computePackItemPrices", () => {
  it("パック限定アイテムだけに単価を付ける: 銀の通常 ¥2,000 ÷ 40 個 = ¥50、銀の文字 ¥2,200 ÷ 20 個 = ¥110（Web の実際は ¥48 / ¥105）", () => {
    const { packs, input } = inputFromFixture();
    const { items, unresolved } = computePackItemPrices(packs, input);
    expect(unresolved).toEqual([]);
    expect(items.map((i) => [i.itemId, i.itemName, i.unitPriceJpy, i.minUnitPriceJpy])).toEqual([
      [13066, "銀の風船", 50, 48],
      [13067, "銀のいいね！", 50, 48],
      [13068, "銀のKP", 50, 48],
      [13069, "銀のハート", 50, 48],
      [13070, "銀の神", 110, 105],
      [13071, "銀のえ？", 110, 105],
      [13072, "銀の草", 110, 105],
      [13073, "銀のかわいい", 110, 105],
    ]);
    expect(items[0]).toMatchObject({ onSale: true, eventKey: "2026_09_gingiragin", pack: { itemId: 13078, name: "銀の通常アイテムパック", price: 1900, listPrice: 2000, pieces: 40, quantity: 10, groupKeys: ["gingiragin_2026"] } });
    expect(items[4].pack).toMatchObject({ itemId: 13079, pieces: 20, quantity: 5 });
  });

  it("単品で売っている中身（ギンギラギン・ぶたさん・季節・風船等）には行を作らない", () => {
    const { packs, input } = inputFromFixture();
    const ids = computePackItemPrices(packs, input).items.map((i) => i.itemId);
    for (const id of [13061, 13062, 13063, 13064, 13065, 1, 2]) expect(ids).not.toContain(id);
  });

  const pack = (over: Partial<PackProduct>): PackProduct => ({
    packItemId: 900,
    packName: "テストパック",
    groupKeys: ["g"],
    productId: "web.test",
    price: 1000,
    listPrice: 1000,
    state: "OPEN",
    imageUrl: null,
    contents: [],
    ...over,
  });
  const X: ItemRef = { itemId: 7, itemName: "限定X", imageUrl: null };

  it("単品とパック限定が混ざるパックは、割引前の価格から単品分を引いた残りを限定アイテムで割る", () => {
    const input = { knownUnitByName: new Map([["単品A", 150]]), refsByName: refsOf([X]), pricedItemIds: new Set<number>() };
    const p = pack({ contents: [{ name: "単品A", rawName: "単品A", quantity: 5 }, { name: "限定X", rawName: "限定X", quantity: 5 }] });
    expect(computePackItemPrices([p], input).items[0].unitPriceJpy).toBe(50); // (1,000 - 750) / 5
    // 単品分だけで割引前の価格を超えるときは全個数で割る
    const input2 = { ...input, knownUnitByName: new Map([["単品A", 250]]) };
    expect(computePackItemPrices([p], input2).items[0].unitPriceJpy).toBe(100); // 1,000 / 10
  });

  it("複数のパックに入っているときは 1 個あたりの高い方（割引の少ない方）", () => {
    const input = { knownUnitByName: new Map<string, number>(), refsByName: refsOf([X]), pricedItemIds: new Set<number>() };
    const a = pack({ packItemId: 1, listPrice: 1000, price: 1000, contents: [{ name: "限定X", rawName: "限定X", quantity: 10 }] });
    const b = pack({ packItemId: 2, listPrice: 1800, price: 1800, contents: [{ name: "限定X", rawName: "限定X", quantity: 20 }] });
    const got = computePackItemPrices([b, a], input).items;
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ unitPriceJpy: 100, pack: { itemId: 1 } });
  });

  it("マスタに無い名前は unresolved、同じ名前が複数あるときはパックと同じイベントのものだけ", () => {
    const old: ItemRef = { itemId: 5, itemName: "限定X", imageUrl: "https://img.whowatch.tv/events/2025/09_gingiragin/x.png" };
    const now: ItemRef = { itemId: 6, itemName: "限定X", imageUrl: "https://img.whowatch.tv/events/2026/09_gingiragin/x.png" };
    const input = { knownUnitByName: new Map<string, number>(), refsByName: refsOf([old, now]), pricedItemIds: new Set<number>() };
    const p = pack({ imageUrl: "https://img.whowatch.tv/events/2026/09_gingiragin/pack.png", contents: [{ name: "限定X", rawName: "限定X", quantity: 4 }, { name: "謎", rawName: "謎", quantity: 1 }] });
    const got = computePackItemPrices([p], input);
    expect(got.items.map((i) => i.itemId)).toEqual([6]);
    expect(got.unresolved).toEqual([{ packName: "テストパック", name: "謎", reason: "マスタに同じ名前のアイテムが無い" }]);
  });
});

describe("packGroupRows / packPriceRows", () => {
  const now = new Date("2026-09-30T00:00:00Z");
  const { packs, input } = inputFromFixture();
  const { items } = computePackItemPrices(packs, input);

  it("パック限定アイテムをパックと同じカテゴリへ（見出しはパックの行から写す・イベントキー付き）", () => {
    const base: ItemGroupRow[] = [
      { itemId: 13078, groupKey: "gingiragin_2026", groupTitle: "ギンギラギン", subGroupTitle: null, badgeText: null, displayOrder: 3, eventKey: null, bannerUrl: null, description: null, syncedAt: now },
      { itemId: 13066, groupKey: "gingiragin_2026", groupTitle: "ギンギラギン", subGroupTitle: null, badgeText: null, displayOrder: 3, eventKey: null, bannerUrl: null, description: null, syncedAt: now },
    ];
    const rows = packGroupRows(base, items, now);
    // 13066 は既にある。13079（文字パック）の行が無いので銀の神〜かわいいは作らない
    expect(rows.map((r) => r.itemId)).toEqual([13067, 13068, 13069]);
    expect(rows[0]).toMatchObject({ groupKey: "gingiragin_2026", groupTitle: "ギンギラギン", displayOrder: 3, eventKey: "2026_09_gingiragin" });
  });

  it("単価行はパック名・割引前の価格・全個数付き。単品の価格がある行は上書きしない", () => {
    const rows = packPriceRows(items, new Set([13067]), now);
    expect(rows.map((r) => r.itemId)).toEqual([13066, 13068, 13069, 13070, 13071, 13072, 13073]);
    expect(rows[0]).toMatchObject({
      itemName: "銀の風船",
      unitPriceJpy: 50,
      minUnitPriceJpy: 48,
      onSale: true,
      products: [{ price: 1900, quantity: 10, state: "OPEN", pack: { itemId: 13078, name: "銀の通常アイテムパック", listPrice: 2000, pieces: 40 } }],
    });
  });
});
