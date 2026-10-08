import { describe, expect, it } from "vitest";
import { isOwner, learnedById, learnedFieldsFor, learnedRatio } from "./learned-display";

const rows = [
  { itemId: "10770", whowatchId: 10770, learnedPoint: 36, learnedSamples: 3 },
  { itemId: "153", whowatchId: 153, learnedPoint: 9, learnedSamples: 1 },
  { itemId: "13103", whowatchId: 13103, learnedPoint: 0, learnedSamples: 13 },
  { itemId: "ouen_zou", whowatchId: 10773, learnedPoint: 50, learnedSamples: 1 },
  { itemId: "10773", whowatchId: 10773, learnedPoint: 58, learnedSamples: 4 },
  { itemId: "1", whowatchId: 1, learnedPoint: null, learnedSamples: 0 },
];
const prices: Record<number, number> = { 10770: 100, 153: 25, 13103: 0, 10773: 160, 500: 50 };
const priceOf = (id: number) => prices[id] ?? null;

describe("learnedById", () => {
  it("未学習（null）を除き、同じ数値 id は観測回数の多い行を使う", () => {
    const m = learnedById(rows);
    expect(m.get(10770)).toEqual({ point: 36, samples: 3 });
    expect(m.get(10773)).toEqual({ point: 58, samples: 4 });
    expect(m.get(13103)).toEqual({ point: 0, samples: 13 });
    expect(m.has(1)).toBe(false);
  });
});

describe("learnedRatio", () => {
  it("学習した単価 ÷ 定価 の中央値（無料・0pt は除く）", () => {
    // 36/100=0.36・9/25=0.36・58/160=0.3625 → 中央値 0.36
    expect(learnedRatio(learnedById(rows), priceOf)).toBeCloseTo(0.36, 5);
  });
  it("学習済みの有料アイテムが無ければ null", () => {
    expect(learnedRatio(learnedById([{ itemId: "13103", whowatchId: 13103, learnedPoint: 0, learnedSamples: 2 }]), priceOf)).toBeNull();
  });
});

describe("learnedFieldsFor", () => {
  const m = learnedById(rows);
  const ratio = learnedRatio(m, priceOf);
  it("学習済みはその値、見込みは出さない", () => {
    expect(learnedFieldsFor(10770, 100, m, ratio)).toEqual({ learnedPoint: 36, learnedSamples: 3, estimatedPoint: null });
  });
  it("未学習で定価があれば 定価 × 比率 の見込み（四捨五入）", () => {
    expect(learnedFieldsFor(500, 50, m, ratio)).toEqual({ learnedPoint: null, learnedSamples: 0, estimatedPoint: 18 });
  });
  it("定価が無い（無料・価格なし）か比率が無ければ見込みも null", () => {
    expect(learnedFieldsFor(999, null, m, ratio).estimatedPoint).toBeNull();
    expect(learnedFieldsFor(500, 50, m, null).estimatedPoint).toBeNull();
  });
});

describe("isOwner", () => {
  it("EXPORT_OWNER_USER_ID と一致するときだけ運営者。未設定なら誰も運営者ではない", () => {
    expect(isOwner("u1", "u1")).toBe(true);
    expect(isOwner("u2", "u1")).toBe(false);
    expect(isOwner("u1", undefined)).toBe(false);
    expect(isOwner(null, "u1")).toBe(false);
    // 空文字で全員一致にならない（item-points の書き込み制限が EXPORT_OWNER_USER_ID の未設定・空で開かないこと・2026-10-08）
    expect(isOwner("u1", "")).toBe(false);
    expect(isOwner("", "")).toBe(false);
  });
});
