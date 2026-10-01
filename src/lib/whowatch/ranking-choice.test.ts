import { describe, expect, it } from "vitest";
import { choicesForOption, defaultChoice, periodKeyAt, pickDefaultRankingType } from "./ranking-choice";

const choice = (rankingType: string, ...parts: string[]) => ({ rankingType, parts });

// 2026_10_magicfantasy の平坦化結果の一部（events.test.ts の STRUCT_SELECTBOX_CHIPS と同じ並び）
const CHOICES = [
  choice("magicfantasy_1st_overall", "1st", "overall"),
  choice("magicfantasy_1st_doll_free", "1st", "doll", "free"),
  choice("magicfantasy_2nd_goods_set_free", "2nd", "goods", "set_free"),
  choice("magicfantasy_2nd_overall", "2nd", "overall"),
];

// 区分の例: 前半 10/1 00:00〜10/7 00:00 JST・後半 10/7 00:00〜10/13 00:00 JST
const PERIODS = [
  { option_key: "1st", starts_at: "2026-09-30T15:00:00.000Z", ends_at: "2026-10-06T15:00:00.000Z" },
  { option_key: "2nd", starts_at: "2026-10-06T15:00:00.000Z", ends_at: "2026-10-12T15:00:00.000Z" },
];

describe("choicesForOption / defaultChoice", () => {
  it("区分（option_key）で絞り込む。区分が無ければ全部（コピー）", () => {
    expect(choicesForOption(CHOICES, "2nd").map((c) => c.rankingType)).toEqual(["magicfantasy_2nd_goods_set_free", "magicfantasy_2nd_overall"]);
    const all = choicesForOption(CHOICES, null);
    expect(all).toEqual(CHOICES);
    expect(all).not.toBe(CHOICES);
  });

  it("既定は「総合」、無ければ先頭、空なら null", () => {
    expect(defaultChoice(choicesForOption(CHOICES, "2nd"))?.rankingType).toBe("magicfantasy_2nd_overall");
    expect(defaultChoice([choice("wolfcoming_across_goods_free", "across", "goods", "free"), choice("wolfcoming_teambattle", "teambattle")])?.rankingType).toBe(
      "wolfcoming_across_goods_free",
    );
    expect(defaultChoice([])).toBeNull();
  });
});

describe("periodKeyAt", () => {
  it("starts_at <= at < ends_at の区分。どこにも入らなければ null", () => {
    expect(periodKeyAt(PERIODS, new Date("2026-09-30T15:00:00.000Z"))).toBe("1st");
    expect(periodKeyAt(PERIODS, new Date("2026-10-06T14:59:59.999Z"))).toBe("1st");
    expect(periodKeyAt(PERIODS, new Date("2026-10-06T15:00:00.000Z"))).toBe("2nd");
    expect(periodKeyAt(PERIODS, new Date("2026-10-12T15:00:00.000Z"))).toBeNull();
    expect(periodKeyAt([{ option_key: "x", starts_at: "不明", ends_at: "不明" }], new Date())).toBeNull();
  });
});

describe("pickDefaultRankingType", () => {
  it("開始日時を含む区分の総合（マジックファンタジー前半に作ったシミュレーター → magicfantasy_1st_overall）", () => {
    expect(pickDefaultRankingType(CHOICES, PERIODS, new Date("2026-09-30T15:00:00.000Z"))).toEqual({ rankingType: "magicfantasy_1st_overall", optionKey: "1st" });
    expect(pickDefaultRankingType(CHOICES, PERIODS, new Date("2026-10-08T03:00:00.000Z"))).toEqual({ rankingType: "magicfantasy_2nd_overall", optionKey: "2nd" });
  });

  it("どの区分にも入らなければ、それより前に始まった最後の区分。全部より前なら最初の区分", () => {
    const withGap = [
      { option_key: "1st", starts_at: "2026-09-30T15:00:00.000Z", ends_at: "2026-10-05T15:00:00.000Z" },
      { option_key: "2nd", starts_at: "2026-10-06T15:00:00.000Z", ends_at: "2026-10-12T15:00:00.000Z" },
    ];
    expect(pickDefaultRankingType(CHOICES, withGap, new Date("2026-10-06T00:00:00.000Z"))?.optionKey).toBe("1st");
    expect(pickDefaultRankingType(CHOICES, withGap, new Date("2026-10-20T00:00:00.000Z"))?.optionKey).toBe("2nd");
    expect(pickDefaultRankingType(CHOICES, withGap, new Date("2026-09-01T00:00:00.000Z"))?.optionKey).toBe("1st");
  });

  it("区分（期間）が無いイベントは全体の総合 → 無ければ先頭", () => {
    expect(pickDefaultRankingType(CHOICES, [], new Date())).toEqual({ rankingType: "magicfantasy_1st_overall", optionKey: null });
    expect(pickDefaultRankingType([choice("psr_gold_a", "gold", "a")], [], new Date())).toEqual({ rankingType: "psr_gold_a", optionKey: null });
  });

  it("選択肢が無い、または選んだ区分に選択肢が無ければ null（別の区分の総合で代用しない）", () => {
    expect(pickDefaultRankingType([], PERIODS, new Date())).toBeNull();
    expect(pickDefaultRankingType(choicesForOption(CHOICES, "1st"), PERIODS, new Date("2026-10-08T03:00:00.000Z"))).toBeNull();
  });
});
