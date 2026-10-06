import { describe, expect, it } from "vitest";
import {
  buildLimitedItemRankingType,
  clampTime,
  currentLimitedItemWindow,
  dailySimulatorWindow,
  eventKeyFromLimitedItemPrefix,
  filterSnapshotsForDatedType,
  isLimitedItemPrefix,
  isLimitedItemRankingType,
  jstDateKey,
  jstDateKeyToDate,
  jstDayWindow,
  LIMITED_ITEM_STRUCT_KEY,
  limitedItemChoiceLabel,
  limitedItemChoices,
  limitedItemInitFromStruct,
  nextJstMidnightAfter,
  normalizeLimitedItemInit,
  OVERALL_PERIOD,
  parseLimitedItemRankingType,
  parseLimitedItemSchedule,
  resolveLimitedItemPeriod,
  resolveLimitedItemRankingType,
} from "./limited-item";

// 2026-10-07 実応答（GET /events/limited_item_rankings_init?event_key=2026_10_gold_digger_1）の縮約
const INIT = {
  period: "20261007",
  select_boxes: [
    { key: "OVERALL", value: "総合ランキング", border: [{ rank: 5 }], tab_type: "overall", event_unit: null },
    { key: "20261007", value: "1日目", border: [{ rank: 5 }], tab_type: "daily", event_unit: null },
  ],
  tabs: {
    daily: [
      { tab_name: "K24", group_id: "1" },
      { tab_name: "K20", group_id: "2" },
      { tab_name: "K18", group_id: "3" },
      { tab_name: "K14", group_id: "4" },
      { tab_name: "K10", group_id: "5" },
    ],
    overall: [{ tab_name: "総合ランキング", group_id: "1" }],
    unique_overall: [{ tab_name: "総合ランキング", group_id: "1" }],
  },
  event_name: "ふわっち黄金発掘隊",
  event_unit: "kg",
  s3folder: "limited_item/gold_digger",
  is_overall_exists: true,
};
const KEY = "2026_10_gold_digger_1";
const PREFIX = `limited-item-${KEY}`;
// 10/7 00:00 JST 〜 10/8 00:00 JST
const DAY1 = { start: new Date("2026-10-06T15:00:00.000Z"), end: new Date("2026-10-07T15:00:00.000Z") };

describe("ranking_type の解釈（limited-item）", () => {
  it("保存形（日付なし）・取得形（日付あり）・総合を読む", () => {
    expect(parseLimitedItemRankingType(`${PREFIX}-2`)).toEqual({ eventKey: KEY, group: 2, period: null });
    expect(parseLimitedItemRankingType(`${PREFIX}-2-20261007`)).toEqual({ eventKey: KEY, group: 2, period: "20261007" });
    expect(parseLimitedItemRankingType(`${PREFIX}-overall`)).toEqual({ eventKey: KEY, group: "overall", period: null });
    // 総合の取得形は API のとおり group=1・period=OVERALL
    expect(parseLimitedItemRankingType(`${PREFIX}-1-OVERALL`)).toEqual({ eventKey: KEY, group: "overall", period: OVERALL_PERIOD });
    expect(isLimitedItemRankingType(`${PREFIX}-5`)).toBe(true);
  });

  it("形が違うものは null（従来の種別・日付の形違い・0 番グループ・総合に日付）", () => {
    expect(parseLimitedItemRankingType("autumncollection_1st_overall")).toBeNull();
    expect(parseLimitedItemRankingType(`${PREFIX}-2-2026-10-07`)).toBeNull();
    expect(parseLimitedItemRankingType(`${PREFIX}-0`)).toBeNull();
    expect(parseLimitedItemRankingType(`${PREFIX}-overall-20261007`)).toBeNull();
    expect(parseLimitedItemRankingType(null)).toBeNull();
    expect(isLimitedItemRankingType("magicfantasy_1st_overall")).toBe(false);
  });

  it("組み立て: 保存形は日付なし、取得形は日付つき、総合は -1-OVERALL", () => {
    expect(buildLimitedItemRankingType(KEY, 2)).toBe(`${PREFIX}-2`);
    expect(buildLimitedItemRankingType(KEY, 2, "20261007")).toBe(`${PREFIX}-2-20261007`);
    expect(buildLimitedItemRankingType(KEY, "overall")).toBe(`${PREFIX}-overall`);
    expect(buildLimitedItemRankingType(KEY, "overall", OVERALL_PERIOD)).toBe(`${PREFIX}-1-OVERALL`);
  });

  it("prefix の判定と event_key の取り出し", () => {
    expect(isLimitedItemPrefix(PREFIX)).toBe(true);
    expect(isLimitedItemPrefix("magicfantasy")).toBe(false);
    expect(isLimitedItemPrefix(null)).toBe(false);
    expect(eventKeyFromLimitedItemPrefix(PREFIX)).toBe(KEY);
    expect(eventKeyFromLimitedItemPrefix("magicfantasy")).toBe("magicfantasy");
  });
});

describe("JST の日付境界（0:00 区切り）", () => {
  it("日付キーは JST で切り替わる（15:00Z = 翌日 0:00 JST）", () => {
    expect(jstDateKey(new Date("2026-10-06T14:59:59.999Z"))).toBe("20261006");
    expect(jstDateKey(new Date("2026-10-06T15:00:00.000Z"))).toBe("20261007");
    expect(jstDateKeyToDate("20261007")?.toISOString()).toBe("2026-10-06T15:00:00.000Z");
    expect(jstDateKeyToDate("2026-10-07")).toBeNull();
  });

  it("1 日の窓は 0:00 JST 〜 翌 0:00 JST", () => {
    const w = jstDayWindow(new Date("2026-10-07T03:00:00.000Z"));
    expect(w).toEqual({ start: new Date("2026-10-06T15:00:00.000Z"), end: new Date("2026-10-07T15:00:00.000Z"), dateKey: "20261007" });
  });

  it("期間に収めてから日付にする（1 日だけのシミュレーターは翌日になっても当日の順位表を見る）", () => {
    expect(resolveLimitedItemPeriod(new Date("2026-10-07T03:00:00.000Z"), DAY1)).toBe("20261007");
    expect(resolveLimitedItemPeriod(new Date("2026-10-07T20:00:00.000Z"), DAY1)).toBe("20261007"); // 10/8 05:00 JST
    expect(resolveLimitedItemPeriod(new Date("2026-10-05T00:00:00.000Z"), DAY1)).toBe("20261007"); // 開始前
    expect(resolveLimitedItemPeriod(new Date("2026-10-07T20:00:00.000Z"), null)).toBe("20261008");
    expect(clampTime(new Date("2026-10-07T15:00:00.000Z"), DAY1).getTime()).toBe(DAY1.end.getTime() - 1);
  });

  it("保存形 → その時点の取得形。日付つき・総合・limited-item 以外はそのまま", () => {
    const now = new Date("2026-10-07T03:00:00.000Z");
    expect(resolveLimitedItemRankingType(`${PREFIX}-2`, now, DAY1)).toBe(`${PREFIX}-2-20261007`);
    expect(resolveLimitedItemRankingType(`${PREFIX}-2-20261006`, now, DAY1)).toBe(`${PREFIX}-2-20261006`);
    expect(resolveLimitedItemRankingType(`${PREFIX}-overall`, now, DAY1)).toBe(`${PREFIX}-1-OVERALL`);
    expect(resolveLimitedItemRankingType("magicfantasy_1st_overall", now, DAY1)).toBe("magicfantasy_1st_overall");
  });

  it("今日の区切り: デイリーは now を含む 1 日とシミュレーター期間の重なり、総合は期間そのもの", () => {
    const sim = { startTime: new Date("2026-10-06T15:00:00.000Z"), endTime: new Date("2026-10-11T15:00:00.000Z") };
    expect(currentLimitedItemWindow(new Date("2026-10-07T20:00:00.000Z"), sim, 2)).toEqual({
      start: new Date("2026-10-07T15:00:00.000Z"),
      end: new Date("2026-10-08T15:00:00.000Z"),
      dateKey: "20261008",
    });
    // 期間が 1 日より短ければ期間の方で切る
    const half = { startTime: new Date("2026-10-07T00:00:00.000Z"), endTime: new Date("2026-10-07T06:00:00.000Z") };
    expect(currentLimitedItemWindow(new Date("2026-10-07T03:00:00.000Z"), half, 1)).toEqual({ start: half.startTime, end: half.endTime, dateKey: "20261007" });
    expect(currentLimitedItemWindow(new Date("2026-10-07T20:00:00.000Z"), sim, "overall")).toEqual({ start: sim.startTime, end: sim.endTime, dateKey: null });
  });

  it("スナップショットはその日の種別だけ残す（大文字小文字は無視）", () => {
    const snaps = [{ rankingType: `${PREFIX}-2-20261006` }, { rankingType: `${PREFIX}-2-20261007` }, { rankingType: `${PREFIX}-2-20261007`.toUpperCase() }];
    expect(filterSnapshotsForDatedType(snaps, `${PREFIX}-2-20261007`)).toHaveLength(2);
    expect(filterSnapshotsForDatedType(snaps, null)).toHaveLength(3);
    expect(filterSnapshotsForDatedType(null, `${PREFIX}-2-20261007`)).toBeNull();
  });
});

describe("初期化 JSON（limited_item_rankings_init）", () => {
  it("グループ（K24〜K10）・総合の有無・単位・ボーダーを正規化する", () => {
    const init = normalizeLimitedItemInit(INIT)!;
    expect(init.period).toBe("20261007");
    expect(init.groups).toEqual([
      { id: 1, name: "K24" },
      { id: 2, name: "K20" },
      { id: 3, name: "K18" },
      { id: 4, name: "K14" },
      { id: 5, name: "K10" },
    ]);
    expect(init.hasOverall).toBe(true);
    expect(init.unit).toBe("kg");
    expect(init.border).toEqual([5]);
    expect(init.eventName).toBe("ふわっち黄金発掘隊");
  });

  it("使えないもの（error_code・空・配列）は null。tabs が無ければ tab_type_settings を見る", () => {
    expect(normalizeLimitedItemInit({ error_code: "Z-002", error_message: "データが見つかりません" })).toBeNull();
    expect(normalizeLimitedItemInit({})).toBeNull();
    expect(normalizeLimitedItemInit([])).toBeNull();
    expect(normalizeLimitedItemInit(null)).toBeNull();
    const viaSettings = normalizeLimitedItemInit({ tab_type_settings: { daily: [{ tab_name: "A", group_id: 1 }] } })!;
    expect(viaSettings.groups).toEqual([{ id: 1, name: "A" }]);
    expect(viaSettings.hasOverall).toBe(false);
  });

  it("struct に包んだ形から取り出す（従来の構造 JSON は null）", () => {
    expect(limitedItemInitFromStruct({ [LIMITED_ITEM_STRUCT_KEY]: INIT })?.groups).toHaveLength(5);
    expect(limitedItemInitFromStruct({ options: [] })).toBeNull();
    expect(limitedItemInitFromStruct(null)).toBeNull();
  });

  it("選択肢: グループごとの保存形 + 総合。parts[0] はグループ番号", () => {
    const choices = limitedItemChoices(PREFIX, normalizeLimitedItemInit(INIT)!);
    expect(choices).toHaveLength(6);
    expect(choices[0]).toEqual({ rankingType: `${PREFIX}-1`, label: "K24", parts: ["1"], border: [{ rank: 5 }] });
    expect(choices[1].rankingType).toBe(`${PREFIX}-2`);
    expect(choices[5]).toMatchObject({ rankingType: `${PREFIX}-overall`, label: "総合ランキング（期間通し）", parts: ["overall"] });
    expect(limitedItemChoiceLabel(`${PREFIX}-2-20261007`, choices)).toBe("K20");
    expect(limitedItemChoiceLabel(`${PREFIX}-overall`, choices)).toBe("総合ランキング（期間通し）");
    expect(limitedItemChoiceLabel(`${PREFIX}-9`, choices)).toBe(`${PREFIX}-9`);
    expect(limitedItemChoiceLabel("magicfantasy_1st_overall", choices)).toBeNull();
  });
});

describe("概要本文の日程（ランキング（N日目））", () => {
  // 2026-10-07 実応答（/users/me/notifications/2359109）の抜粋
  const RULES = [
    "イベントスケジュール",
    "内容",
    "日程",
    "ランキング（1日目）",
    "2026年10月7日（水） 00:00 〜 24:00",
    "ランキング（2日目）",
    "2026年10月8日（木） 00:00 〜 24:00",
    "ランキング（3日目）",
    "2026年10月9日（金） 00:00 〜 24:00",
    "ランキング（4日目）",
    "2026年10月10日（土） 00:00 〜 24:00",
    "ランキング（5日目）",
    "2026年10月11日（日） 00:00 〜 24:00",
    "特典付与",
    "（ふわっちポイント）",
    "各ランキング終了後の翌営業日（予定）",
  ].join("\n");

  it("5 日分を読み、全体期間は 1 日目の 0:00 〜 5 日目の 24:00（翌 0:00 JST）", () => {
    const s = parseLimitedItemSchedule(RULES);
    expect(s.days.map((d) => d.dateKey)).toEqual(["20261007", "20261008", "20261009", "20261010", "20261011"]);
    expect(s.days[0]).toMatchObject({ index: 1, startsAt: new Date("2026-10-06T15:00:00.000Z"), endsAt: new Date("2026-10-07T15:00:00.000Z") });
    expect(s.startsAt?.toISOString()).toBe("2026-10-06T15:00:00.000Z");
    expect(s.endsAt?.toISOString()).toBe("2026-10-11T15:00:00.000Z");
  });

  it("年の省略は直前の年（無ければ fallbackYear）。時刻が無ければ 0:00〜24:00。日程が無ければ空", () => {
    const s = parseLimitedItemSchedule("ランキング（1日目）\n10月7日（水）\nランキング（2日目）\n10月8日（木） 00:00 〜 24:00", 2026);
    expect(s.days.map((d) => d.dateKey)).toEqual(["20261007", "20261008"]);
    expect(s.endsAt?.toISOString()).toBe("2026-10-08T15:00:00.000Z");
    expect(parseLimitedItemSchedule("ランキング（1日目）\n10月7日", null).days).toEqual([]);
    expect(parseLimitedItemSchedule(null)).toEqual({ days: [], startsAt: null, endsAt: null });
  });
});

describe("dailySimulatorWindow（作成フォームの 24 時間の既定）", () => {
  // イベント期間 10/7 00:00 〜 10/12 00:00 JST
  const BOUNDS = { start: new Date("2026-10-06T15:00:00.000Z"), end: new Date("2026-10-11T15:00:00.000Z") };

  it("期間中なら今日の 0:00〜翌 0:00 JST", () => {
    // 10/7 01:11 JST
    expect(dailySimulatorWindow(new Date("2026-10-06T16:11:00.000Z"), BOUNDS)).toEqual({
      start: new Date("2026-10-06T15:00:00.000Z"),
      end: new Date("2026-10-07T15:00:00.000Z"),
      dateKey: "20261007",
    });
  });

  it("開始前なら 1 日目、終了後なら最終日", () => {
    expect(dailySimulatorWindow(new Date("2026-10-05T00:00:00.000Z"), BOUNDS).dateKey).toBe("20261007");
    const last = dailySimulatorWindow(new Date("2026-10-20T00:00:00.000Z"), BOUNDS);
    expect(last).toEqual({ start: new Date("2026-10-10T15:00:00.000Z"), end: new Date("2026-10-11T15:00:00.000Z"), dateKey: "20261011" });
  });

  it("期間が無ければその日の 1 日。期間が日の途中で始まる・終わるなら切る", () => {
    expect(dailySimulatorWindow(new Date("2026-10-07T03:00:00.000Z"))).toEqual(jstDayWindow(new Date("2026-10-07T03:00:00.000Z")));
    const half = dailySimulatorWindow(new Date("2026-10-07T03:00:00.000Z"), { start: new Date("2026-10-07T00:00:00.000Z"), end: new Date("2026-10-07T06:00:00.000Z") });
    expect(half).toEqual({ start: new Date("2026-10-07T00:00:00.000Z"), end: new Date("2026-10-07T06:00:00.000Z"), dateKey: "20261007" });
  });

  it("終了 = 開始日の翌日 0:00 JST（開始がちょうど 0:00 なら +24h、日中なら次の 0:00）", () => {
    expect(nextJstMidnightAfter(new Date("2026-10-06T15:00:00.000Z")).toISOString()).toBe("2026-10-07T15:00:00.000Z"); // 10/7 00:00 → 10/8 00:00
    expect(nextJstMidnightAfter(new Date("2026-10-07T04:00:00.000Z")).toISOString()).toBe("2026-10-07T15:00:00.000Z"); // 10/7 13:00 → 10/8 00:00
    expect(nextJstMidnightAfter(new Date("2026-10-07T14:59:59.000Z")).toISOString()).toBe("2026-10-07T15:00:00.000Z"); // 10/7 23:59:59 → 10/8 00:00
  });
});
