import { describe, expect, it } from "vitest";
import { LIMITED_ITEM_STRUCT_KEY } from "./limited-item";
import {
  buildN1RankingType,
  buildWgpRankingType,
  currentPeriodicWindow,
  defaultPeriodWindow,
  hasAutoDivision,
  isPerpetualFamily,
  isPeriodicPrefix,
  jstMonthKey,
  jstMonthWindow,
  jstMonthWindowAt,
  n1ApiRankingType,
  n1Choices,
  n1RoundAt,
  n1RoundWindow,
  parsePeriodicRankingType,
  periodEndAfter,
  periodicChoiceLabel,
  periodicChoices,
  periodicEventSchedule,
  periodicSchemeFor,
  periodicSchemeOf,
  periodicSiblingTypes,
  periodMaxSpanMs,
  periodWindowAt,
  periodWindowOfKey,
  resolvePeriodicRankingType,
  wgpChoices,
  wgpMonthKeyFromEventKey,
  wgpRankingPath,
} from "./periodic-ranking";
import { defaultChoice } from "./ranking-choice";

// JST = UTC+9。2026-10-01 0:00 JST = 2026-09-30T15:00Z
const OCT1 = new Date("2026-09-30T15:00:00.000Z");
const OCT11 = new Date("2026-10-10T15:00:00.000Z");
const OCT21 = new Date("2026-10-20T15:00:00.000Z");
const NOV1 = new Date("2026-10-31T15:00:00.000Z");
/** 2026-10-07 12:00 JST */
const NOW = new Date("2026-10-07T03:00:00.000Z");
const DAY7 = { start: new Date("2026-10-06T15:00:00.000Z"), end: new Date("2026-10-07T15:00:00.000Z") };

describe("JST の月と N-1 の回", () => {
  it("月キーは JST で決める（10/31 24:00 = 11/1 0:00 JST は 11 月）", () => {
    expect(jstMonthKey(NOW)).toBe("202610");
    expect(jstMonthKey(new Date("2026-10-31T14:59:59.000Z"))).toBe("202610");
    expect(jstMonthKey(NOV1)).toBe("202611");
  });

  it("月の期間は 1 日 0:00 〜 翌月 1 日 0:00 JST（12 月・2 月の繰り上がりも含む）", () => {
    expect(jstMonthWindow("202610")).toEqual({ start: OCT1, end: NOV1 });
    expect(jstMonthWindow("202612")).toEqual({ start: new Date("2026-11-30T15:00:00.000Z"), end: new Date("2026-12-31T15:00:00.000Z") });
    expect(jstMonthWindow("202602")).toEqual({ start: new Date("2026-01-31T15:00:00.000Z"), end: new Date("2026-02-28T15:00:00.000Z") });
    expect(jstMonthWindow("202613")).toBeNull();
    expect(jstMonthWindow("2026")).toBeNull();
    expect(jstMonthWindowAt(NOW)).toEqual({ start: OCT1, end: NOV1, key: "202610" });
  });

  it("回は 1〜10 日 / 11〜20 日 / 21 日〜月末（0:00 JST 区切り）", () => {
    expect(n1RoundAt(NOW)).toEqual({ round: "1st", monthKey: "202610" });
    expect(n1RoundAt(new Date("2026-10-10T14:59:59.000Z")).round).toBe("1st"); // 10/10 23:59:59 JST
    expect(n1RoundAt(OCT11).round).toBe("2nd");
    expect(n1RoundAt(new Date("2026-10-20T03:00:00.000Z")).round).toBe("2nd");
    expect(n1RoundAt(OCT21).round).toBe("3rd");
    expect(n1RoundAt(new Date("2026-10-31T10:00:00.000Z")).round).toBe("3rd");
    expect(n1RoundAt(NOV1)).toEqual({ round: "1st", monthKey: "202611" });
  });

  it("回の期間（3 回目は翌月 1 日 0:00 まで）", () => {
    expect(n1RoundWindow("202610", "1st")).toEqual({ start: OCT1, end: OCT11, key: "202610-1st" });
    expect(n1RoundWindow("202610", "2nd")).toEqual({ start: OCT11, end: OCT21, key: "202610-2nd" });
    expect(n1RoundWindow("202610", "3rd")).toEqual({ start: OCT21, end: NOV1, key: "202610-3rd" });
    expect(n1RoundWindow("20261", "1st")).toBeNull();
  });
});

describe("期間の切り替え方（scheme）", () => {
  it("now を含む期間", () => {
    expect(periodWindowAt("daily", NOW)).toEqual({ ...DAY7, key: "20261007" });
    expect(periodWindowAt("n1round", NOW)).toEqual({ start: OCT1, end: OCT11, key: "202610-1st" });
    expect(periodWindowAt("monthly", NOW)).toEqual({ start: OCT1, end: NOV1, key: "202610" });
    expect(periodWindowAt("whole", NOW)).toBeNull();
  });

  it("期間キーから期間へ（形が違えば null）", () => {
    expect(periodWindowOfKey("daily", "20261007")).toEqual({ ...DAY7, key: "20261007" });
    expect(periodWindowOfKey("n1round", "202610-2nd")).toEqual({ start: OCT11, end: OCT21, key: "202610-2nd" });
    expect(periodWindowOfKey("monthly", "202610")).toEqual({ start: OCT1, end: NOV1, key: "202610" });
    expect(periodWindowOfKey("n1round", "202610")).toBeNull();
    expect(periodWindowOfKey("daily", "2026-10-07")).toBeNull();
    expect(periodWindowOfKey("whole", "x")).toBeNull();
  });

  it("開始を手で変えたときの終了 = 開始を含む期間の終わり", () => {
    const oct7_13 = new Date("2026-10-07T04:00:00.000Z");
    expect(periodEndAfter("daily", oct7_13)).toEqual(DAY7.end);
    expect(periodEndAfter("n1round", oct7_13)).toEqual(OCT11);
    expect(periodEndAfter("n1round", OCT21)).toEqual(NOV1);
    expect(periodEndAfter("monthly", oct7_13)).toEqual(NOV1);
    expect(periodEndAfter("whole", oct7_13)).toBeNull();
  });

  it("「1 期間ぶん」とみなす最長の幅", () => {
    expect(periodMaxSpanMs("daily")).toBe(36 * 60 * 60 * 1000);
    expect(periodMaxSpanMs("n1round")).toBe(12 * 24 * 60 * 60 * 1000);
    expect(periodMaxSpanMs("monthly")).toBe(32 * 24 * 60 * 60 * 1000);
    expect(periodMaxSpanMs("whole")).toBe(Number.POSITIVE_INFINITY);
  });

  it("既定の期間はイベントの期間に収める（開始前は最初の回・終了後は最後の回）", () => {
    const bounds = { start: OCT1, end: NOV1 };
    expect(defaultPeriodWindow("n1round", NOW, bounds)).toEqual({ start: OCT1, end: OCT11, key: "202610-1st" });
    expect(defaultPeriodWindow("n1round", new Date("2026-09-20T03:00:00.000Z"), bounds)).toEqual({ start: OCT1, end: OCT11, key: "202610-1st" });
    expect(defaultPeriodWindow("n1round", new Date("2026-11-03T03:00:00.000Z"), bounds)).toEqual({ start: OCT21, end: NOV1, key: "202610-3rd" });
    expect(defaultPeriodWindow("monthly", NOW, bounds)).toEqual({ start: OCT1, end: NOV1, key: "202610" });
    // daily は limited-item.ts の dailySimulatorWindow と同じ
    expect(defaultPeriodWindow("daily", NOW, bounds)).toEqual({ ...DAY7, key: "20261007" });
    // whole はイベントの期間そのもの
    expect(defaultPeriodWindow("whole", NOW, bounds)).toEqual({ start: OCT1, end: NOV1, key: null });
  });
});

describe("種別（ranking_type）の解釈", () => {
  it("WGP: wgp-daily / wgp-overall と期間つき", () => {
    expect(parsePeriodicRankingType("wgp-daily")).toEqual({ family: "wgp", baseType: "wgp-daily", division: "daily", scheme: "daily", periodKey: null });
    expect(parsePeriodicRankingType("wgp-daily-20261007")).toMatchObject({ family: "wgp", baseType: "wgp-daily", periodKey: "20261007" });
    expect(parsePeriodicRankingType("wgp-overall-202610")).toMatchObject({ family: "wgp", baseType: "wgp-overall", scheme: "monthly", periodKey: "202610" });
    // デイリーに月キー・総合に日付キーは不正
    expect(parsePeriodicRankingType("wgp-daily-202610")).toBeNull();
    expect(parsePeriodicRankingType("wgp-overall-20261007")).toBeNull();
    expect(parsePeriodicRankingType("wgp-award")).toBeNull();
    expect(buildWgpRankingType("daily", "20261007")).toBe("wgp-daily-20261007");
    expect(buildWgpRankingType("overall")).toBe("wgp-overall");
  });

  it("N-1: n1-{male|female|rookie|total} と期間つき", () => {
    expect(parsePeriodicRankingType("n1-male")).toEqual({ family: "n1", baseType: "n1-male", division: "male", scheme: "n1round", periodKey: null });
    expect(parsePeriodicRankingType("n1-male-202610-1st")).toMatchObject({ family: "n1", division: "male", scheme: "n1round", periodKey: "202610-1st" });
    expect(parsePeriodicRankingType("n1-rookie-202609-3rd")).toMatchObject({ division: "rookie", periodKey: "202609-3rd" });
    expect(parsePeriodicRankingType("n1-total-202610")).toMatchObject({ family: "n1", division: "total", scheme: "monthly", periodKey: "202610" });
    expect(parsePeriodicRankingType("n1-total-202610-1st")).toBeNull();
    expect(parsePeriodicRankingType("n1-male-202610")).toBeNull();
    expect(parsePeriodicRankingType("n1-unknown")).toBeNull();
    expect(buildN1RankingType("female", "202610-2nd")).toBe("n1-female-202610-2nd");
  });

  it("期間限定アイテム型は limited-item.ts の解釈をそのまま使う。従来の種別は null", () => {
    expect(parsePeriodicRankingType("limited-item-2026_10_gold_digger_1-2")).toEqual({
      family: "limited-item",
      baseType: "limited-item-2026_10_gold_digger_1-2",
      division: "2",
      scheme: "daily",
      periodKey: null,
    });
    expect(parsePeriodicRankingType("limited-item-2026_10_gold_digger_1-2-20261007")).toMatchObject({ periodKey: "20261007" });
    expect(parsePeriodicRankingType("limited-item-2026_10_gold_digger_1-overall")).toMatchObject({ scheme: "whole", division: "overall" });
    expect(parsePeriodicRankingType("autumncollection_1st_overall")).toBeNull();
    expect(parsePeriodicRankingType("")).toBeNull();
    expect(parsePeriodicRankingType(null)).toBeNull();
    expect(periodicSchemeOf("wgp-overall")).toBe("monthly");
    expect(periodicSchemeOf("magicfantasy_1st_overall")).toBeNull();
  });

  it("prefix と種別（空 = 自動判定も含む）から切り替え方を決める", () => {
    expect(periodicSchemeFor("limited-item-2026_10_gold_digger_1", "")).toBe("daily");
    expect(periodicSchemeFor("limited-item-2026_10_gold_digger_1", "limited-item-2026_10_gold_digger_1-overall")).toBe("whole");
    expect(periodicSchemeFor("wgp", null)).toBe("daily");
    expect(periodicSchemeFor("wgp", "wgp-overall")).toBe("monthly");
    expect(periodicSchemeFor("n1", "")).toBe("n1round");
    expect(periodicSchemeFor("n1", "n1-total")).toBe("monthly");
    expect(periodicSchemeFor("magicfantasy", "magicfantasy_1st_overall")).toBeNull();
    expect(periodicSchemeFor(null, null)).toBeNull();
    expect(isPeriodicPrefix("wgp")).toBe(true);
    expect(isPeriodicPrefix("n1")).toBe(true);
    expect(isPeriodicPrefix("limited-item-x")).toBe(true);
    expect(isPeriodicPrefix("wolfcoming")).toBe(false);
    // 区分を「自動判定」で空のまま作れるのは、本人の属性で決まる家族だけ
    expect(hasAutoDivision("limited-item-x")).toBe(true);
    expect(hasAutoDivision("n1")).toBe(true);
    expect(hasAutoDivision("wgp")).toBe(false);
  });
});

describe("取得・記録する期間つきの種別", () => {
  it("保存形に「今」の期間を付ける。期間（window）に収めるので、翌日になっても 1 日だけの期間ならその日のまま", () => {
    expect(resolvePeriodicRankingType("wgp-daily", NOW)).toBe("wgp-daily-20261007");
    expect(resolvePeriodicRankingType("wgp-daily", new Date("2026-10-07T20:00:00.000Z"), DAY7)).toBe("wgp-daily-20261007"); // 10/8 05:00 JST
    expect(resolvePeriodicRankingType("wgp-overall", NOW)).toBe("wgp-overall-202610");
    expect(resolvePeriodicRankingType("n1-male", NOW)).toBe("n1-male-202610-1st");
    expect(resolvePeriodicRankingType("n1-male", new Date("2026-10-15T03:00:00.000Z"))).toBe("n1-male-202610-2nd");
    // 11/1 0:00 JST ちょうどでも、期間が 10 月 3 回目なら 3 回目の順位表
    expect(resolvePeriodicRankingType("n1-male", NOV1, { start: OCT21, end: NOV1 })).toBe("n1-male-202610-3rd");
    expect(resolvePeriodicRankingType("n1-total", NOW)).toBe("n1-total-202610");
    // 期間つきはそのまま。limited-item は委譲。従来の種別もそのまま
    expect(resolvePeriodicRankingType("n1-female-202609-3rd", NOW)).toBe("n1-female-202609-3rd");
    expect(resolvePeriodicRankingType("limited-item-2026_10_gold_digger_1-2", NOW)).toBe("limited-item-2026_10_gold_digger_1-2-20261007");
    expect(resolvePeriodicRankingType("limited-item-2026_10_gold_digger_1-overall", NOW)).toBe("limited-item-2026_10_gold_digger_1-1-OVERALL");
    expect(resolvePeriodicRankingType("autumncollection_1st_overall", NOW)).toBe("autumncollection_1st_overall");
  });

  it("画面の「今の区切り」= 今を含む期間とシミュレーターの期間の重なり", () => {
    const sim = { startTime: OCT1, endTime: NOV1 };
    const oct8 = new Date("2026-10-08T03:00:00.000Z");
    expect(currentPeriodicWindow(oct8, sim, "wgp-daily")).toEqual({ start: new Date("2026-10-07T15:00:00.000Z"), end: new Date("2026-10-08T15:00:00.000Z"), key: "20261008" });
    expect(currentPeriodicWindow(oct8, sim, "n1-male")).toEqual({ start: OCT1, end: OCT11, key: "202610-1st" });
    expect(currentPeriodicWindow(oct8, sim, "n1-total")).toEqual({ start: OCT1, end: NOV1, key: "202610" });
    // 期間が切り替わらない種別はシミュレーターの期間そのもの
    expect(currentPeriodicWindow(oct8, sim, "limited-item-2026_10_gold_digger_1-overall")).toEqual({ start: OCT1, end: NOV1, key: null });
    // limited-item のデイリーは limited-item.ts と同じ
    expect(currentPeriodicWindow(NOW, { startTime: DAY7.start, endTime: DAY7.end }, "limited-item-2026_10_gold_digger_1-2")).toEqual({ ...DAY7, key: "20261007" });
    expect(currentPeriodicWindow(oct8, sim, "autumncollection_1st_overall")).toBeNull();
    expect(currentPeriodicWindow(oct8, sim, null)).toBeNull();
  });
});

describe("区分の選択肢と兄弟", () => {
  it("WGP はデイリー（既定 = 先頭）と月間総合", () => {
    expect(wgpChoices().map((c) => c.rankingType)).toEqual(["wgp-daily", "wgp-overall"]);
    expect(defaultChoice(wgpChoices())?.rankingType).toBe("wgp-daily");
    expect(wgpChoices()[1].label).toContain("21 日");
    expect(periodicChoices("wgp")).toEqual(wgpChoices());
  });

  it("N-1 は男性・女性・ルーキー・全期間（上位 10 名が入賞）", () => {
    expect(n1Choices().map((c) => c.rankingType)).toEqual(["n1-male", "n1-female", "n1-rookie", "n1-total"]);
    expect(n1Choices().every((c) => c.border[0]?.rank === 10)).toBe(true);
    expect(periodicChoices("n1")).toEqual(n1Choices());
    expect(periodicChoiceLabel("n1-rookie-202610-1st")).toContain("ルーキー");
    expect(periodicChoiceLabel("wgp-overall")).toContain("月間総合");
    expect(periodicChoiceLabel("autumncollection_1st_overall")).toBeNull();
  });

  it("limited-item・従来の prefix は periodicChoices の対象外（struct から作る）", () => {
    expect(periodicChoices("limited-item-2026_10_gold_digger_1")).toBeNull();
    expect(periodicChoices("magicfantasy")).toBeNull();
    expect(periodicChoices(null)).toBeNull();
  });

  it("本人を探すときに見る兄弟: N-1 は他の 2 部門、limited-item は struct の他グループ。総合・月間・WGP は無し", () => {
    expect(periodicSiblingTypes("n1-male", null)).toEqual(["n1-female", "n1-rookie"]);
    expect(periodicSiblingTypes("n1-rookie", null)).toEqual(["n1-male", "n1-female"]);
    expect(periodicSiblingTypes("n1-total", null)).toEqual([]);
    expect(periodicSiblingTypes("wgp-daily", null)).toEqual([]);
    expect(periodicSiblingTypes("wgp-overall", null)).toEqual([]);
    const struct = { [LIMITED_ITEM_STRUCT_KEY]: { tabs: { daily: [{ tab_name: "K24", group_id: "1" }, { tab_name: "K20", group_id: "2" }, { tab_name: "K18", group_id: "3" }] } } };
    expect(periodicSiblingTypes("limited-item-2026_10_gold_digger_1-2", struct)).toEqual(["limited-item-2026_10_gold_digger_1-1", "limited-item-2026_10_gold_digger_1-3"]);
    expect(periodicSiblingTypes("limited-item-2026_10_gold_digger_1-2", null)).toEqual([]);
    expect(periodicSiblingTypes("limited-item-2026_10_gold_digger_1-overall", struct)).toEqual([]);
    expect(periodicSiblingTypes("autumncollection_1st_overall", null)).toEqual([]);
  });
});

describe("公開 API との対応とイベントの期間", () => {
  it("WGP の event_key → 開催月、API のパス", () => {
    expect(wgpMonthKeyFromEventKey("2026_10_whowatchgrandprix")).toBe("202610");
    expect(wgpMonthKeyFromEventKey("2026_7_whowatchgrandprix")).toBe("202607");
    expect(wgpMonthKeyFromEventKey("nice_one_ranking")).toBeNull();
    expect(wgpMonthKeyFromEventKey(null)).toBeNull();
    expect(wgpRankingPath("daily", "20261007")).toBe("/wgp/ranking/20261007");
    expect(wgpRankingPath("overall", "202610")).toBe("/wgp/ranking/overall/202610");
  });

  it("N-1 の種別 → 公開 API の種別（nice_one_1st_male / nice_one_total）と月", () => {
    expect(n1ApiRankingType("male", "202610-1st")).toEqual({ apiType: "nice_one_1st_male", monthKey: "202610" });
    expect(n1ApiRankingType("rookie", "202609-3rd")).toEqual({ apiType: "nice_one_3rd_rookie", monthKey: "202609" });
    expect(n1ApiRankingType("total", "202610")).toEqual({ apiType: "nice_one_total", monthKey: "202610" });
    expect(n1ApiRankingType("total", "202610-1st")).toBeNull();
    expect(n1ApiRankingType("male", "202610")).toBeNull();
  });

  it("/event_lists に日付が無い家族の期間: WGP は開催月、N-1 は常設なので今月", () => {
    expect(periodicEventSchedule("wgp", "2026_10_whowatchgrandprix", NOW)).toEqual({ startsAt: OCT1, endsAt: NOV1 });
    // event_key から月が読めなければ now の月
    expect(periodicEventSchedule("wgp", "whowatchgrandprix", NOW)).toEqual({ startsAt: OCT1, endsAt: NOV1 });
    expect(periodicEventSchedule("n1", "nice_one_ranking", NOW)).toEqual({ startsAt: OCT1, endsAt: NOV1 });
    expect(periodicEventSchedule("n1", "nice_one_ranking", NOV1)).toEqual({ startsAt: NOV1, endsAt: new Date("2026-11-30T15:00:00.000Z") });
    expect(periodicEventSchedule("limited-item-2026_10_gold_digger_1", "2026_10_gold_digger_1", NOW)).toBeNull();
    expect(periodicEventSchedule("magicfantasy", "2026_10_magicfantasy", NOW)).toBeNull();
  });

  it("常設（終わりが無い）のは N-1 だけ", () => {
    expect(isPerpetualFamily("n1-male")).toBe(true);
    expect(isPerpetualFamily(null, "n1")).toBe(true);
    expect(isPerpetualFamily("wgp-daily")).toBe(false);
    expect(isPerpetualFamily(null, "wgp")).toBe(false);
    expect(isPerpetualFamily("limited-item-2026_10_gold_digger_1-2")).toBe(false);
  });
});
