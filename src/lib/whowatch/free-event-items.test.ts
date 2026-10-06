import { describe, expect, it } from "vitest";
import { buildFreeItemGroupRows, eventKeyFromImageUrl, eventSuffix } from "./free-event-items";
import type { RawCategory } from "./item-groups-sync";

const NOW = new Date("2026-09-26T00:00:00Z");

describe("eventKeyFromImageUrl", () => {
  it("events/YYYY/MM_key/ からイベントキーを作る", () => {
    expect(eventKeyFromImageUrl("https://img.whowatch.tv/events/2026/09_autumncollection/item_meter_omake.png")).toBe("2026_09_autumncollection");
    expect(eventKeyFromImageUrl("https://img.whowatch.tv/events/2026/09_wolfcoming/item_side_free.png")).toBe("2026_09_wolfcoming");
  });
  it("年月フォルダの無いパスは対象外", () => {
    expect(eventKeyFromImageUrl("https://img.whowatch.tv/events/ouen_mouse/item_ouen-mouse.png")).toBeNull();
    expect(eventKeyFromImageUrl("https://img.whowatch.tv/playitems/free/item_rainbow-megaphone.png")).toBeNull();
    expect(eventKeyFromImageUrl(null)).toBeNull();
  });
});

describe("buildFreeItemGroupRows", () => {
  const categories: RawCategory[] = [
    { group: "autumncollection", title: "オータムグッズ", display_order: 2, play_item: [{ id: 13088 }] },
    { group: "wolfcoming", title: "オオカミさんがやってくる！", display_order: 6, play_item: [{ id: 13100 }] },
  ];
  const eventGroupByKey = new Map([
    ["2026_09_autumncollection", "autumncollection"],
    ["2026_09_autumncollectionlite", "autumncollection"],
    ["2026_09_wolfcoming", "wolfcoming"],
  ]);
  const patterns = [
    { itemId: 13083, imageUrl: "https://img.whowatch.tv/events/2026/09_autumncollection/item_meter_omake.png" }, // どんぐり（無料）
    { itemId: 13085, imageUrl: "https://img.whowatch.tv/events/2026/09_autumncollection/item_meter_free.png" }, // どんぐり帽子（無料）
    { itemId: 13085, imageUrl: "https://img.whowatch.tv/events/2026/09_autumncollection/item_meter_free_x2.png" }, // 同 item の別パターン
    { itemId: 13088, imageUrl: "https://img.whowatch.tv/events/2026/09_autumncollection/item_pay.png" }, // 有料（単価あり）
    { itemId: 13097, imageUrl: "https://img.whowatch.tv/events/2026/09_wolfcoming/item_side_omake.png" }, // 赤ずきんダッシュサイコロ（無料）
    { itemId: 9999, imageUrl: "https://img.whowatch.tv/events/2024/03_gotochi2024/item_x.png" }, // 終了イベント（key 不明）
    { itemId: 11243, imageUrl: "https://img.whowatch.tv/events/ouen_mouse/item_ouen-mouse.png" }, // 年月フォルダなし
  ];
  it("無料 × イベント画像 × ITEM タブ key がカテゴリにあるものだけ、is_free=true で 1 行ずつ作る", () => {
    const rows = buildFreeItemGroupRows({ patterns, pricedItemIds: new Set([13088]), eventGroupByKey, categories }, NOW);
    expect(rows.map((r) => [r.itemId, r.groupKey, r.isFree, r.eventKey])).toEqual([
      [13083, "autumncollection", true, "2026_09_autumncollection"],
      [13085, "autumncollection", true, "2026_09_autumncollection"],
      [13097, "wolfcoming", true, "2026_09_wolfcoming"],
    ]);
    expect(rows[0]).toMatchObject({ groupTitle: "オータムグッズ", displayOrder: 2 });
  });
  it("毎年のイベントが前の年の画像を使い回しても、開催中のイベントに付ける（2026-10-07 実例 2026_10_art）", () => {
    const art: RawCategory[] = [...categories, { group: "art2026", title: "芸術の秋", display_order: 3, play_item: [{ id: 13200 }] }];
    const byKey = new Map([...eventGroupByKey, ["2026_10_art", "art2026"]]);
    const old = [{ itemId: 10122, imageUrl: "https://img.whowatch.tv/events/2022/10_art/item_brush.png" }];
    const rows = buildFreeItemGroupRows({ patterns: old, pricedItemIds: new Set(), eventGroupByKey: byKey, categories: art }, NOW);
    expect(rows.map((r) => [r.itemId, r.groupKey, r.eventKey])).toEqual([[10122, "art2026", "2026_10_art"]]);
    // 同じ MM_key のイベントが無ければ付けない
    expect(buildFreeItemGroupRows({ patterns: old, pricedItemIds: new Set(), eventGroupByKey, categories }, NOW)).toEqual([]);
  });
  it("eventSuffix は年を外した MM_key を返す", () => {
    expect(eventSuffix("2026_10_art")).toBe("10_art");
    expect(eventSuffix("whowatch_dojo")).toBeNull();
    expect(eventSuffix(null)).toBeNull();
  });
  it("カテゴリが payments3 に無い（終了）イベントには付けない", () => {
    const rows = buildFreeItemGroupRows({ patterns, pricedItemIds: new Set(), eventGroupByKey: new Map([["2024_03_gotochi2024", "gotochi2024"]]), categories }, NOW);
    expect(rows).toEqual([]);
  });
});
