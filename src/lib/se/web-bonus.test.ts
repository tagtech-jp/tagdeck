import { describe, expect, it } from "vitest";
import { isWebBonusItem } from "./web-bonus";

describe("isWebBonusItem", () => {
  it("価格なしのネズミ・メガホン・ハートを WEBおまけ扱いにする", () => {
    expect(isWebBonusItem({ itemName: "チューと半端な応援をするネズミさん", priceJpy: null })).toBe(true);
    expect(isWebBonusItem({ itemName: "チューと半端な応援をする金のネズミさん", priceJpy: null })).toBe(true);
    expect(isWebBonusItem({ itemName: "メガホン", priceJpy: null })).toBe(true);
    expect(isWebBonusItem({ itemName: "ふわっちくんメガホン", priceJpy: null })).toBe(true);
    expect(isWebBonusItem({ itemName: "ねこハート", priceJpy: null })).toBe(true);
    expect(isWebBonusItem({ itemName: "イースタースイーツ(Web)", priceJpy: null })).toBe(true);
  });
  it("価格ありや無関係な名前は対象外", () => {
    expect(isWebBonusItem({ itemName: "メガホン", priceJpy: 160 })).toBe(false);
    expect(isWebBonusItem({ itemName: "風船", priceJpy: null })).toBe(false);
    expect(isWebBonusItem({ itemName: "6月もイベント応援するゾウ！", priceJpy: 160 })).toBe(false);
  });
});
