import { describe, expect, it } from "vitest";
import { buildExportItems, numericItemId } from "./item-export";

const at = new Date("2026-09-28T00:00:00Z");
const rows = [
  { itemId: "13100", itemName: "おばあさんたぬっち", priceJpy: 160, productId: "web.ranking.wolf_tanucchi.1.sale", state: "OPEN", whowatchId: 13100, lastFetchedAt: at },
  { itemId: "13097", itemName: "赤ずきんダッシュサイコロ", priceJpy: 0, productId: "", state: "FREE", whowatchId: 13097, lastFetchedAt: at },
  { itemId: "12880", itemName: "スター", priceJpy: 30, productId: "web.star.3", state: "OPEN", whowatchId: 12880, lastFetchedAt: at },
  { itemId: "ouen_pig", itemName: "旧シード", priceJpy: 160, productId: "", state: "OPEN", whowatchId: 0, lastFetchedAt: null },
];
const groups = [
  { itemId: 13100, groupKey: "wolfcoming", eventKey: null, isFree: false, displayOrder: 3 },
  { itemId: 13097, groupKey: "wolfcoming", eventKey: "2026_09_wolfcoming", isFree: true, displayOrder: 3 },
  { itemId: 12880, groupKey: "word", eventKey: null, isFree: false, displayOrder: 9 },
];
const events = [
  { id: 900, eventKey: "2026_09_wolfcoming", itemGroupKey: "wolfcoming", status: "open" },
  { id: 800, eventKey: "2026_08_wolfcoming_old", itemGroupKey: "wolfcoming", status: "closed" },
];

describe("buildExportItems", () => {
  it("有料はカテゴリ key → whowatch_events.item_group_key の逆引き、無料は groups.event_key でイベントを付ける", () => {
    const out = buildExportItems(rows, groups, events);
    const byId = Object.fromEntries(out.map((o) => [o.item_id, o]));
    expect(byId["13100"]).toMatchObject({ price_jpy: 160, purchasable: true, event_id: 900, event_key: "2026_09_wolfcoming", group_keys: ["wolfcoming"], on_sale: true, state: "OPEN" });
    expect(byId["13097"]).toMatchObject({ price_jpy: 0, purchasable: false, event_id: 900, event_key: "2026_09_wolfcoming", on_sale: false, state: "FREE" });
    expect(byId["12880"]).toMatchObject({ price_jpy: 30, purchasable: true, event_id: null, event_key: null, group_keys: ["word"] });
    expect(byId["13100"].last_fetched_at).toBe("2026-09-28T00:00:00.000Z");
  });

  it("whowatch_id が無い旧シード行は item_id をそのまま使い、購入不可・イベントなしになる", () => {
    const out = buildExportItems(rows, groups, events);
    const seed = out.find((o) => o.item_id === "ouen_pig");
    expect(seed).toMatchObject({ purchasable: false, event_id: null, group_keys: [], last_fetched_at: null });
  });

  it("同じカテゴリを複数イベントが指すときは open > pre > closed を選ぶ。数値 id 順に並ぶ", () => {
    const out = buildExportItems(rows, groups, events);
    expect(out.map((o) => o.item_id)).toEqual(["12880", "13097", "13100", "ouen_pig"]);
    expect(out.find((o) => o.item_id === "13100")?.event_id).toBe(900);
  });

  it("同じ数値 id の行は 1 行にする（数値 item_id の同期行を優先。無ければ last_fetched_at が新しい方）", () => {
    const dup = [
      { itemId: "ouen_zou", itemName: "イベント応援するゾウ!", priceJpy: 160, productId: "", state: "OPEN", whowatchId: 10773, lastFetchedAt: new Date("2026-09-28T00:00:00Z") },
      { itemId: "10773", itemName: "イベント応援するゾウ！", priceJpy: 160, productId: "web.ranking.ouen_zou.1.sale", state: "OPEN", whowatchId: 10773, lastFetchedAt: new Date("2026-09-27T00:00:00Z") },
      { itemId: "legacy_a", itemName: "古い", priceJpy: 100, productId: "", state: "OPEN", whowatchId: 555, lastFetchedAt: new Date("2026-09-01T00:00:00Z") },
      { itemId: "legacy_b", itemName: "新しい", priceJpy: 120, productId: "", state: "OPEN", whowatchId: 555, lastFetchedAt: new Date("2026-09-20T00:00:00Z") },
    ];
    const out = buildExportItems(dup, [], []);
    expect(out.map((o) => [o.item_id, o.item_name, o.price_jpy, o.purchasable])).toEqual([
      ["555", "新しい", 120, false],
      ["10773", "イベント応援するゾウ！", 160, true],
    ]);
  });

  it("学習単価（learned_*）は既定では付けない（ログイン Cookie の利用者向け）", () => {
    const learnedRows = rows.map((r) => (r.itemId === "13100" ? { ...r, learnedPoint: 64, learnedSamples: 3, learnedAt: at } : r));
    const out = buildExportItems(learnedRows, groups, events);
    expect(out.every((o) => !("learned_point" in o) && !("learned_samples" in o) && !("learned_at" in o))).toBe(true);
  });

  it("includeLearned のときは学習単価を付け、未学習は null / 0 にする", () => {
    const learnedRows = rows.map((r) => (r.itemId === "13100" ? { ...r, learnedPoint: 64, learnedSamples: 3, learnedAt: at } : r));
    const byId = Object.fromEntries(buildExportItems(learnedRows, groups, events, { includeLearned: true }).map((o) => [o.item_id, o]));
    expect(byId["13100"]).toMatchObject({ learned_point: 64, learned_samples: 3, learned_at: "2026-09-28T00:00:00.000Z" });
    expect(byId["12880"]).toMatchObject({ learned_point: null, learned_samples: 0, learned_at: null });
  });

  it("同じ数値 id の行が重なるときは、観測回数の多い行の学習単価を使う（無料 0 pt も学習単価として出す）", () => {
    const dup = [
      { itemId: "ouen_zou", itemName: "旧シード", priceJpy: 160, productId: "", state: "OPEN", whowatchId: 10773, lastFetchedAt: at, learnedPoint: 70, learnedSamples: 1, learnedAt: at },
      { itemId: "10773", itemName: "イベント応援するゾウ！", priceJpy: 160, productId: "p", state: "OPEN", whowatchId: 10773, lastFetchedAt: at, learnedPoint: 80, learnedSamples: 5, learnedAt: at },
      { itemId: "10863", itemName: "ふわっちくんメガホン", priceJpy: 0, productId: "", state: "FREE", whowatchId: 10863, lastFetchedAt: at, learnedPoint: 0, learnedSamples: 2, learnedAt: null },
    ];
    const byId = Object.fromEntries(buildExportItems(dup, [], [], { includeLearned: true }).map((o) => [o.item_id, o]));
    expect(byId["10773"]).toMatchObject({ item_name: "イベント応援するゾウ！", learned_point: 80, learned_samples: 5 });
    expect(byId["10863"]).toMatchObject({ price_jpy: 0, learned_point: 0, learned_samples: 2, learned_at: null });
  });

  it("numericItemId は whowatch_id を優先し、無ければ数値の item_id、それも無ければ null", () => {
    expect(numericItemId({ itemId: "1", whowatchId: 13100 })).toBe(13100);
    expect(numericItemId({ itemId: "42", whowatchId: 0 })).toBe(42);
    expect(numericItemId({ itemId: "ouen_pig", whowatchId: 0 })).toBeNull();
  });
});
