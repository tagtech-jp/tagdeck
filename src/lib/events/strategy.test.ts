import { describe, it, expect } from "vitest";
import {
  rankItemsByEfficiency,
  projectRivalFinals,
  computeReverseTarget,
  composeItemPlan,
  type ItemMasterEntry,
} from "./strategy";
import { DEFAULT_EVENT_TEMPLATE, type EventTypeTemplate } from "./event-templates";
import type { RivalState } from "./monte-carlo";

const ITEMS: ItemMasterEntry[] = [
  { itemId: "ouen_pig", name: "ぶたさん", basePoint: 160, priceJpy: 160 },
  { itemId: "ouen_wanchan", name: "ワンちゃん", basePoint: 160, priceJpy: 160 },
  { itemId: "no_price", name: "価格未同期アイテム", basePoint: 100, priceJpy: 0 },
];

describe("rankItemsByEfficiency", () => {
  it("ranks by ptPerYen and applies itemMultipliers override over defaultMultiplier", () => {
    const template: EventTypeTemplate = {
      ...DEFAULT_EVENT_TEMPLATE,
      defaultMultiplier: 2,
      itemMultipliers: { ouen_wanchan: 33 },
    };
    const ranked = rankItemsByEfficiency(ITEMS, template);

    expect(ranked[0].itemId).toBe("ouen_wanchan");
    expect(ranked[0].multiplier).toBe(33);
    expect(ranked[0].effectivePt).toBe(160 * 33);
    // 33倍 > 等倍/2倍のため先頭に来る
    expect(ranked[0].ptPerYen).toBeGreaterThan(ranked[1].ptPerYen);
  });

  it("falls back to basePoint as the yen basis when priceJpy is 0", () => {
    const template: EventTypeTemplate = { ...DEFAULT_EVENT_TEMPLATE, defaultMultiplier: 1 };
    const ranked = rankItemsByEfficiency(ITEMS, template);
    const noPrice = ranked.find((r) => r.itemId === "no_price")!;
    expect(noPrice.ptPerYen).toBe(1); // basePoint(100)*1 / basePoint(100) = 1
  });

  it("marks every result as an assumption tied to the template", () => {
    const ranked = rankItemsByEfficiency(ITEMS, DEFAULT_EVENT_TEMPLATE);
    for (const r of ranked) {
      expect(r.isAssumption).toBe(true);
      expect(r.ceoConfirmedAt).toBeNull();
    }
  });
});

describe("projectRivalFinals", () => {
  it("projects p50 as pace-only and p90 as pace+1.2816*stdDev, scaled linearly by remainingHours", () => {
    const rivals: RivalState[] = [{ name: "A", currentScore: 1000, paceMean: 100, paceStdDev: 10 }];
    const [proj] = projectRivalFinals(rivals, 2);
    expect(proj.finalP50).toBe(1000 + 100 * 2);
    expect(proj.finalP90).toBeCloseTo(1000 + (100 + 1.2816 * 10) * 2, 5);
  });

  it("never projects a score decrease even with negative pace", () => {
    const rivals: RivalState[] = [{ name: "A", currentScore: 500, paceMean: -50, paceStdDev: 5 }];
    const [proj] = projectRivalFinals(rivals, 3);
    expect(proj.finalP50).toBe(500);
  });
});

describe("computeReverseTarget", () => {
  it("score型: 単純差分をp50=p90で返す", () => {
    const result = computeReverseTarget({ kind: "score", targetScore: 10000, currentScore: 4000 });
    expect(result.kind).toBe("estimate");
    if (result.kind === "estimate") {
      expect(result.requiredAdditionalPt).toEqual({ p50: 6000, p90: 6000 });
      expect(result.targetFinalScore).toBeNull();
    }
  });

  it("score型: 既に達成済みなら0", () => {
    const result = computeReverseTarget({ kind: "score", targetScore: 100, currentScore: 500 });
    expect(result.kind).toBe("estimate");
    if (result.kind === "estimate") {
      expect(result.requiredAdditionalPt).toEqual({ p50: 0, p90: 0 });
    }
  });

  it("ranking型: 自分のエントリ未特定なら insufficient_data", () => {
    const result = computeReverseTarget({
      kind: "ranking",
      targetRank: 3,
      currentScore: 100,
      paceMean: 50,
      paceStdDev: 5,
      paceHistoryLength: 10,
      rivals: [],
      remainingHours: 5,
      myEntryFound: false,
    });
    expect(result).toEqual({ kind: "insufficient_data", reason: "自分のエントリを特定できません" });
  });

  it("ranking型: コールドスタート(paceHistory<3件)なら insufficient_data", () => {
    const result = computeReverseTarget({
      kind: "ranking",
      targetRank: 1,
      currentScore: 0,
      paceMean: 0,
      paceStdDev: 100,
      paceHistoryLength: 1,
      rivals: [],
      remainingHours: 5,
      myEntryFound: true,
    });
    expect(result.kind).toBe("insufficient_data");
  });

  it("ranking型: 目標順位が近傍窓内なら閾値ライバルのp50/p90にバッファを乗せて返す", () => {
    const rivals: RivalState[] = [
      { name: "1位", currentScore: 2000, paceMean: 100, paceStdDev: 10 },
      { name: "2位", currentScore: 1500, paceMean: 80, paceStdDev: 10 },
      { name: "3位", currentScore: 1000, paceMean: 50, paceStdDev: 5 },
    ];
    const result = computeReverseTarget({
      kind: "ranking",
      targetRank: 2,
      currentScore: 900,
      paceMean: 60,
      paceStdDev: 10,
      paceHistoryLength: 5,
      rivals,
      remainingHours: 1,
      myEntryFound: true,
      bufferRatio: 0.02,
    });
    expect(result.kind).toBe("estimate");
    if (result.kind === "estimate") {
      // targetRank=2位以内 → 投影後2番目に高いスコア(1500+80*1=1580、元「2位」ライバル)を
      // 超えれば足りる。1位ライバル(2100)を超える必要はない。
      expect(result.targetFinalScore!.p50).toBeCloseTo((1500 + 80 * 1) * 1.02, 5);
      expect(result.requiredAdditionalPt.p50).toBeGreaterThan(0);
    }
  });

  it("ranking型: 目標順位が±3近傍窓外なら外挿せず増分目安にフォールバック", () => {
    const rivals: RivalState[] = [{ name: "1位", currentScore: 1000, paceMean: 50, paceStdDev: 5 }];
    const result = computeReverseTarget({
      kind: "ranking",
      targetRank: 10, // rivalsは1件のみ → idx=9は存在しない
      currentScore: 500,
      paceMean: 30,
      paceStdDev: 5,
      paceHistoryLength: 5,
      rivals,
      remainingHours: 1,
      myEntryFound: true,
    });
    expect(result.kind).toBe("estimate");
    if (result.kind === "estimate") {
      expect(result.disclaimer).toContain("取得範囲外");
    }
  });
});

describe("composeItemPlan", () => {
  it("必要ptを効率順アイテムの個数(切り上げ)に変換する", () => {
    const template: EventTypeTemplate = { ...DEFAULT_EVENT_TEMPLATE, defaultMultiplier: 2 };
    const ranked = rankItemsByEfficiency(
      [{ itemId: "a", name: "アイテムA", basePoint: 100, priceJpy: 100 }],
      template
    );
    const plan = composeItemPlan({ p50: 350, p90: 500 }, ranked);
    // effectivePt = 100*2 = 200 → ceil(350/200)=2, ceil(500/200)=3
    expect(plan[0].countP50).toBe(2);
    expect(plan[0].countP90).toBe(3);
    expect(plan[0].note).toContain("目安");
  });

  it("respects topN and never returns more items than requested", () => {
    const template: EventTypeTemplate = { ...DEFAULT_EVENT_TEMPLATE, defaultMultiplier: 1 };
    const ranked = rankItemsByEfficiency(ITEMS, template);
    const plan = composeItemPlan({ p50: 100, p90: 100 }, ranked, 2);
    expect(plan.length).toBe(2);
  });
});
