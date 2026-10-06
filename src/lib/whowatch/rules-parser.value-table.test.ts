import { describe, expect, it } from "vitest";
import { parseMultiplierTable, parseRules, parseValueTable, RULES_PARSER_VERSION } from "./rules-parser";

// 2026-10-07 実応答（黄金発掘隊 概要 通知 2359109）の htmlToText 結果の縮約。表はセルごとに 1 行になる
const GOLD_TEXT = `
イベントルール
視聴者が専用アイテムを使用することで金塊を発掘できます
1日の配信内で発掘した金塊の合計重量で順位が決まります。
専用アイテム（黄金発掘隊）
黄金発掘隊アイテムを使うと金塊の絵柄と重量がランダムに表示されます。
発掘できる金塊と確率は以下の通りです。
金塊の絵柄
出現率
重量
ふわっちポイント
ボーナス
超巨大な金塊
0.1%
500 kg 〜
5,000 pt
巨大な金塊
3.9%
300 kg 〜 499 kg
100 pt
大きい金塊
16%
100 kg 〜 299 kg
25 pt
中くらいの金塊
30%
50 kg 〜 99 kg
-
小さい金塊
50%
10 kg 〜 49 kg
-
黄金発掘隊アイテムをまとめて使った場合、金塊の絵柄と重量を決める抽選はまとめて使った数量分だけ行われます。
`;

describe("parseValueTable（獲得量の表・重量表）", () => {
  it("黄金発掘隊: 5 段を読み、開いた上限は null、ボーナス pt と絵柄の名前も拾う", () => {
    const t = parseValueTable(GOLD_TEXT)!;
    expect(t.unit).toBe("kg");
    expect(t.rows).toHaveLength(5);
    expect(t.rows[0]).toEqual({ label: "超巨大な金塊", probability: 0.1, min: 500, max: null, bonusPoint: 5000 });
    expect(t.rows[1]).toEqual({ label: "巨大な金塊", probability: 3.9, min: 300, max: 499, bonusPoint: 100 });
    expect(t.rows[3]).toEqual({ label: "中くらいの金塊", probability: 30, min: 50, max: 99, bonusPoint: null });
    expect(t.rows[4]).toEqual({ label: "小さい金塊", probability: 50, min: 10, max: 49, bonusPoint: null });
    expect(t.rows.reduce((a, r) => a + r.probability, 0)).toBeCloseTo(100, 5);
  });

  it("重量表の % は倍率表としては読まない（全段 1 倍の偽の表を作らない）", () => {
    expect(parseMultiplierTable(GOLD_TEXT)).toBeNull();
  });

  it("確率の合計が 100 にならない断片や、単位も範囲記号も無い数値は表とみなさない", () => {
    expect(parseValueTable("10%\n500 kg 〜\n20%\n10 kg 〜 49 kg")).toBeNull();
    expect(parseValueTable("50%\n20\n50%\n30")).toBeNull();
    expect(parseValueTable("")).toBeNull();
  });

  it("parseRules に valueTable / valueUnit が入り、版は 2", () => {
    const r = parseRules(GOLD_TEXT, new Date("2026-10-07T00:00:00Z"));
    expect(RULES_PARSER_VERSION).toBe(2);
    expect(r.parserVersion).toBe(2);
    expect(r.valueUnit).toBe("kg");
    expect(r.valueTable?.map((x) => x.min)).toEqual([500, 300, 100, 50, 10]);
    expect(r.multiplierTable).toBeNull();
    expect(r.expectedMultiplier).toBeNull();
  });
});
