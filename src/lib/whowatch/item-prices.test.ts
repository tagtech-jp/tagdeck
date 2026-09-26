import { describe, expect, it } from "vitest";
import { flattenPrices, giftTotalYen, unitPriceFromProducts } from "./item-prices";
import type { RawCategory } from "./item-groups-sync";

const PIG = [
  { id: 5724, price: 160, quantity: 1, state: "OPEN", product_id: "web.ranking.ouen_pig.1.sale" },
  { id: 5725, price: 800, quantity: 5, state: "OPEN", product_id: "web.ranking.ouen_pig.5.sale" },
  { id: 5726, price: 1580, quantity: 10, state: "OPEN", product_id: "web.ranking.ouen_pig.10.sale" },
  { id: 5730, price: 145000, quantity: 1000, state: "OPEN", product_id: "web.ranking.ouen_pig.sale.1000.sale" },
];

describe("unitPriceFromProducts", () => {
  it("定価の単価は最小個数の商品（1 個 ¥160）、最安単価はまとめ買い（1000 個 ¥145,000 → ¥145）", () => {
    const u = unitPriceFromProducts(PIG)!;
    expect(u.unitPriceJpy).toBe(160);
    expect(u.minUnitPriceJpy).toBe(145);
    expect(u.onSale).toBe(true);
    expect(u.products.map((p) => p.quantity)).toEqual([1, 5, 10, 1000]);
  });
  it("最小商品が 3 個入り（スター 3 個 ¥90）なら単価は ¥30（従来は ¥90 と誤認）", () => {
    const u = unitPriceFromProducts([
      { price: 90, quantity: 3, state: "OPEN", product_id: "rke.90" },
      { price: 290, quantity: 10, state: "OPEN", product_id: "rke.290" },
    ])!;
    expect(u.unitPriceJpy).toBe(30);
    expect(u.minUnitPriceJpy).toBe(29);
  });
  it("OPEN が無ければ全商品から求め on_sale=false、価格が無ければ null", () => {
    const u = unitPriceFromProducts([{ price: 500, quantity: 1, state: "CLOSED", product_id: "x" }])!;
    expect(u.unitPriceJpy).toBe(500);
    expect(u.onSale).toBe(false);
    expect(unitPriceFromProducts([])).toBeNull();
    expect(unitPriceFromProducts([{ price: 0, quantity: 1, state: "OPEN", product_id: "free" }])).toBeNull();
    expect(unitPriceFromProducts(undefined)).toBeNull();
  });
  it("複数カテゴリで同じ商品が重複しても 1 つに数える", () => {
    const u = unitPriceFromProducts([...PIG, ...PIG])!;
    expect(u.products).toHaveLength(4);
  });
});

describe("flattenPrices", () => {
  it("カテゴリをまたぐ同一アイテムは 1 行にまとめ、価格の無いアイテムは行を作らない", () => {
    const categories: RawCategory[] = [
      { group: "a", title: "A", play_item: [{ id: 10842, name: "ぶたさん", play_item_payment_product: PIG } as never] },
      { group: "b", title: "B", play_item: [{ id: 10842, name: "ぶたさん", play_item_payment_product: PIG } as never, { id: 231, name: "イースター(Web)", play_item_payment_product: [] } as never] },
    ];
    const rows = flattenPrices(categories, new Date("2026-09-26T00:00:00Z"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ itemId: 10842, itemName: "ぶたさん", unitPriceJpy: 160, minUnitPriceJpy: 145, onSale: true });
  });
});

describe("giftTotalYen", () => {
  it("合計 = 単価 × 個数。単価不明は 0", () => {
    expect(giftTotalYen(160, 4)).toBe(640);
    expect(giftTotalYen(160, 0)).toBe(160);
    expect(giftTotalYen(null, 3)).toBe(0);
  });
});
