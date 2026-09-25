import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractPeriodsFromRules, jstDate, resolveEventPeriods } from "./periods";

// 2026-09-20 実応答（オータムグッズ 概要 通知 2329967）の htmlToText 結果
const AUTUMN_RULES = readFileSync(path.join(__dirname, "__fixtures__", "autumncollection_rules_text.txt"), "utf8");
const AUTUMN_OPTIONS = [
  { key: "1st", value: "前半" },
  { key: "2nd", value: "後半" },
];
// /event_lists の全体期間: 9/18 00:00 JST 〜 9/27 23:59:59 JST
const OVERALL = { startsAt: new Date(1789657200000), endsAt: new Date(1790521199000) };

describe("jstDate", () => {
  it("JST を UTC に変換し、24:00 は翌日 00:00 になる", () => {
    expect(jstDate(2026, 9, 18, 0, 0).toISOString()).toBe("2026-09-17T15:00:00.000Z");
    expect(jstDate(2026, 9, 22, 24, 0).toISOString()).toBe("2026-09-22T15:00:00.000Z"); // 9/23 00:00 JST
  });
});

describe("extractPeriodsFromRules（実物 fixture）", () => {
  it("＜前半＞ 9/18 0:00〜9/22 24:00、＜後半＞ 9/23 00:00〜9/27 24:00 を JST で取る", () => {
    const m = extractPeriodsFromRules(AUTUMN_RULES, AUTUMN_OPTIONS, 2026);
    expect(m.get("1st")!.starts_at.toISOString()).toBe("2026-09-17T15:00:00.000Z");
    expect(m.get("1st")!.ends_at.toISOString()).toBe("2026-09-22T15:00:00.000Z"); // 24:00 → 翌日 0:00
    expect(m.get("2nd")!.starts_at.toISOString()).toBe("2026-09-22T15:00:00.000Z");
    expect(m.get("2nd")!.ends_at.toISOString()).toBe("2026-09-27T15:00:00.000Z"); // 9/28 00:00 JST
  });

  it("年が省略された日付は直前の日付の年を引き継ぐ", () => {
    const text = "ランキング＜前半＞\n2026年9月18日（金）0:00 ～\n9月22日（火）24:00\nランキング＜後半＞\n9月23日（水）00:00 ～ 9月27日（日）24:00";
    const m = extractPeriodsFromRules(text, AUTUMN_OPTIONS, null);
    expect(m.get("1st")!.ends_at.toISOString()).toBe("2026-09-22T15:00:00.000Z");
    expect(m.get("2nd")!.starts_at.toISOString()).toBe("2026-09-22T15:00:00.000Z");
    expect(m.get("2nd")!.ends_at.toISOString()).toBe("2026-09-27T15:00:00.000Z");
  });

  it("年が一度も無く fallbackYear も無ければ取れない", () => {
    const text = "ランキング＜前半＞\n9月18日（金）0:00 ～ 9月22日（火）24:00";
    expect(extractPeriodsFromRules(text, AUTUMN_OPTIONS, null).size).toBe(0);
  });
});

describe("resolveEventPeriods", () => {
  it("rules から取れた区分は source:'rules'", () => {
    const p = resolveEventPeriods(AUTUMN_RULES, AUTUMN_OPTIONS, OVERALL);
    expect(p).toEqual([
      { option_key: "1st", label: "前半", starts_at: "2026-09-17T15:00:00.000Z", ends_at: "2026-09-22T15:00:00.000Z", source: "rules" },
      { option_key: "2nd", label: "後半", starts_at: "2026-09-22T15:00:00.000Z", ends_at: "2026-09-27T15:00:00.000Z", source: "rules" },
    ]);
  });

  it("抽出できない区分は全体期間を等分して source:'estimated'", () => {
    const p = resolveEventPeriods("本文に日付なし", AUTUMN_OPTIONS, OVERALL);
    expect(p.map((x) => x.source)).toEqual(["estimated", "estimated"]);
    expect(p[0].starts_at).toBe(OVERALL.startsAt.toISOString());
    expect(p[1].ends_at).toBe(OVERALL.endsAt.toISOString());
    const mid = new Date((OVERALL.startsAt.getTime() + OVERALL.endsAt.getTime()) / 2).toISOString();
    expect(p[0].ends_at).toBe(mid);
    expect(p[1].starts_at).toBe(mid);
  });

  it("一部だけ取れた場合は混在する", () => {
    const text = "ランキング＜後半＞\n2026年9月23日（水）00:00 ～ 2026年9月27日（日）24:00";
    const p = resolveEventPeriods(text, AUTUMN_OPTIONS, OVERALL);
    expect(p[0].source).toBe("estimated");
    expect(p[1].source).toBe("rules");
  });

  it("全体期間が無く rules も無ければ空、options が無ければ空", () => {
    expect(resolveEventPeriods("なし", AUTUMN_OPTIONS, { startsAt: null, endsAt: null })).toEqual([]);
    expect(resolveEventPeriods(AUTUMN_RULES, [], OVERALL)).toEqual([]);
  });
});
