import { describe, expect, it } from "vitest";
import { LEARNED_MAX_ITEMS, parseLearnedBody, summarizeUpdate, toRecordsetJson } from "./learned-points";

describe("parseLearnedBody", () => {
  it("本文が無いときは 0 件として受け付ける（同期ルート共通テストの空 POST）", () => {
    expect(parseLearnedBody(null)).toEqual({ ok: true, items: [] });
    expect(parseLearnedBody(undefined)).toEqual({ ok: true, items: [] });
    expect(parseLearnedBody({ items: [] })).toEqual({ ok: true, items: [] });
  });

  it("正しい本文を受け付け、単価を小数第 2 位に丸め、同じ item_id は後の方を使う", () => {
    const r = parseLearnedBody({
      items: [
        { item_id: "10773", learned_point: 80, samples: 1 },
        { item_id: "1", learned_point: 0.333333, samples: 3 },
        { item_id: "10773", learned_point: 81.5, samples: 2 },
      ],
    });
    expect(r).toEqual({
      ok: true,
      items: [
        { itemId: "10773", learnedPoint: 81.5, samples: 2 },
        { itemId: "1", learnedPoint: 0.33, samples: 3 },
      ],
    });
  });

  it("無料アイテム（0 pt）も受け付ける", () => {
    expect(parseLearnedBody({ items: [{ item_id: "10863", learned_point: 0, samples: 4 }] })).toEqual({ ok: true, items: [{ itemId: "10863", learnedPoint: 0, samples: 4 }] });
  });

  it.each([
    ["items が無い", {}],
    ["item_id が数字でない", { items: [{ item_id: "ouen_pig", learned_point: 1, samples: 1 }] }],
    ["item_id が 0 始まり", { items: [{ item_id: "0123", learned_point: 1, samples: 1 }] }],
    ["item_id が数値型", { items: [{ item_id: 10773, learned_point: 1, samples: 1 }] }],
    ["単価が負", { items: [{ item_id: "1", learned_point: -1, samples: 1 }] }],
    ["単価が NaN 相当（文字列）", { items: [{ item_id: "1", learned_point: "80", samples: 1 }] }],
    ["観測回数が 0", { items: [{ item_id: "1", learned_point: 1, samples: 0 }] }],
    ["観測回数が小数", { items: [{ item_id: "1", learned_point: 1, samples: 1.5 }] }],
  ])("%s → 400 相当（ok: false）", (_label, body) => {
    expect(parseLearnedBody(body).ok).toBe(false);
  });

  it(`${LEARNED_MAX_ITEMS} 件を超えると受け付けない`, () => {
    const items = Array.from({ length: LEARNED_MAX_ITEMS + 1 }, (_, i) => ({ item_id: String(i + 1), learned_point: 1, samples: 1 }));
    expect(parseLearnedBody({ items }).ok).toBe(false);
    expect(parseLearnedBody({ items: items.slice(0, LEARNED_MAX_ITEMS) }).ok).toBe(true);
  });
});

describe("toRecordsetJson", () => {
  it("文字列と数値の両方の item_id を持つ JSON にする", () => {
    expect(JSON.parse(toRecordsetJson([{ itemId: "10773", learnedPoint: 80, samples: 2 }]))).toEqual([{ id: "10773", num: 10773, point: 80, samples: 2 }]);
  });
});

describe("summarizeUpdate", () => {
  const items = [
    { itemId: "10773", learnedPoint: 80, samples: 2 },
    { itemId: "1", learnedPoint: 40, samples: 1 },
    { itemId: "99999", learnedPoint: 5, samples: 1 },
  ];

  it("数値の行と旧シード行（whowatch_id が同じ）をまとめて 1 件に数え、行が無い item_id は missing に入れる", () => {
    const rows = [
      { item_id: "ouen_zou", whowatch_id: 10773, learned_point: 80, learned_samples: 2 },
      { item_id: "10773", whowatch_id: 10773, learned_point: 80, learned_samples: 2 },
      { item_id: "1", whowatch_id: 1, learned_point: 40, learned_samples: 1 },
    ];
    expect(summarizeUpdate(items, rows)).toEqual({
      updated: [
        { item_id: "10773", learned_point: 80, learned_samples: 2, rows: 2 },
        { item_id: "1", learned_point: 40, learned_samples: 1, rows: 1 },
      ],
      missing: ["99999"],
    });
  });

  it("whowatch_id が 0 の行は数値の一致に使わない", () => {
    const rows = [{ item_id: "legacy", whowatch_id: 0, learned_point: 1, learned_samples: 1 }];
    expect(summarizeUpdate([{ itemId: "1", learnedPoint: 1, samples: 1 }], rows)).toEqual({ updated: [], missing: ["1"] });
  });
});
