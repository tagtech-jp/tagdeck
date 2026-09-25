import { describe, expect, it } from "vitest";
import { bumpQuota, parseQuota, POLL_WARN_THRESHOLD, quotaDateKey, shouldWarnQuota } from "./poll-quota";

const day1 = new Date(2026, 8, 23, 10, 0, 0); // 2026-09-23 10:00 ローカル
const day2 = new Date(2026, 8, 24, 0, 1, 0); // 日付が変わった直後

describe("quotaDateKey", () => {
  it("ローカル時間の YYYY-MM-DD を返す", () => {
    expect(quotaDateKey(day1)).toBe("2026-09-23");
    expect(quotaDateKey(day2)).toBe("2026-09-24");
  });
});

describe("bumpQuota", () => {
  it("初回は 1 から数える", () => {
    expect(bumpQuota(null, day1)).toEqual({ date: "2026-09-23", count: 1 });
  });

  it("同じ日なら積み上げる", () => {
    let q = bumpQuota(null, day1);
    q = bumpQuota(q, day1);
    q = bumpQuota(q, day1);
    expect(q.count).toBe(3);
  });

  it("日付が変わったら数え直す", () => {
    const prev = { date: "2026-09-23", count: 20_000 };
    expect(bumpQuota(prev, day2)).toEqual({ date: "2026-09-24", count: 1 });
  });
});

describe("shouldWarnQuota", () => {
  it("閾値に達したら警告する", () => {
    expect(shouldWarnQuota({ date: "2026-09-23", count: POLL_WARN_THRESHOLD - 1 })).toBe(false);
    expect(shouldWarnQuota({ date: "2026-09-23", count: POLL_WARN_THRESHOLD })).toBe(true);
  });

  it("未計測なら警告しない", () => {
    expect(shouldWarnQuota(null)).toBe(false);
  });
});

describe("parseQuota", () => {
  it("保存した値を読み戻せる", () => {
    const q = { date: "2026-09-23", count: 42 };
    expect(parseQuota(JSON.stringify(q))).toEqual(q);
  });

  it("壊れた値は null にして数え直す", () => {
    expect(parseQuota(null)).toBeNull();
    expect(parseQuota("not json")).toBeNull();
    expect(parseQuota('{"date":"2026-09-23"}')).toBeNull();
    expect(parseQuota('{"count":5}')).toBeNull();
    expect(parseQuota('"文字列"')).toBeNull();
  });
});
