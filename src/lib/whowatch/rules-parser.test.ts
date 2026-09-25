import { describe, expect, it } from "vitest";
import { expectedMultiplier, parseBonusTable, parseFreeItem, parseMultiplierTable, parseRules } from "./rules-parser";

// 2026-09-20 実応答（オータムグッズ 概要 通知 2329967）の htmlToText 結果の縮約
const AUTUMN_TEXT = `
オータムリース（無料）
イベント期間中、毎日グループ数×3個貰えます。
有効期限は当日中で1グループにつき最大3個まで使用できます。
10%の確率でランキングポイントが10倍になります。
イベント期間中、ランダムに出る当たりに応じてランキングポイントが変化します。（当選確率は以下の表をご参照ください。）
ランキングポイント倍率
1%
20倍
4%
10倍
10%
5倍
85%
「オータムコレクション」をまとめて使った場合、ランキングポイントを決める抽選は1回だけ行います。
ランキングポイント
レギュラー
ボーナス
ランキングポイント
250pt
6%
ビッグ
ボーナス
ランキングポイント
500pt
2%
ギガ
ボーナス
ランキングポイント
1,000pt
0.7%
`;

describe("parseMultiplierTable / expectedMultiplier", () => {
  it("1%=20倍 / 4%=10倍 / 10%=5倍 / 85%=通常 を抽出し、期待値 1.95 を返す", () => {
    const rows = parseMultiplierTable(AUTUMN_TEXT)!;
    expect(rows).toEqual([
      { probability: 1, multiplier: 20 },
      { probability: 4, multiplier: 10 },
      { probability: 10, multiplier: 5 },
      { probability: 85, multiplier: 1 },
    ]);
    // 0.01*20 + 0.04*10 + 0.10*5 + 0.85*1 = 0.2+0.4+0.5+0.85 = 1.95
    expect(expectedMultiplier(rows)).toBe(1.95);
  });

  it("確率の合計が 100 にならない断片は表とみなさない", () => {
    expect(parseMultiplierTable("ランキングポイント倍率\n1%\n20倍\n4%\n10倍")).toBeNull();
    expect(expectedMultiplier(null)).toBeNull();
  });
});

describe("parseBonusTable", () => {
  it("等級・pt・確率を拾う（pt が無ければ null）", () => {
    const rows = parseBonusTable(AUTUMN_TEXT)!;
    expect(rows).toEqual([
      { grade: "レギュラー", point: 250, probability: 6 },
      { grade: "ビッグ", point: 500, probability: 2 },
      { grade: "ギガ", point: 1000, probability: 0.7 },
    ]);
    const noPt = parseBonusTable("レギュラー\nボーナス\n6%")!;
    expect(noPt[0]).toEqual({ grade: "レギュラー", point: null, probability: 6 });
  });
});

describe("parseFreeItem", () => {
  it("毎日グループ数×3個、10%で10倍", () => {
    expect(parseFreeItem(AUTUMN_TEXT)).toEqual({ perDay: 3, perGroup: true, hit: { probability: 10, multiplier: 10 } });
  });
  it("記載が無ければ null", () => {
    expect(parseFreeItem("配布はありません")).toBeNull();
  });
});

describe("parseRules", () => {
  it("全項目をまとめ、無い項目は null", () => {
    const r = parseRules(AUTUMN_TEXT, new Date("2026-09-21T00:00:00Z"));
    expect(r.expectedMultiplier).toBe(1.95);
    expect(r.parserVersion).toBe(1);
    const empty = parseRules("");
    expect(empty.multiplierTable).toBeNull();
    expect(empty.bonusTable).toBeNull();
    expect(empty.freeItem).toBeNull();
  });
});
