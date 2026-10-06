import { describe, expect, it, vi } from "vitest";
import { eventSimulators, whowatchEvents } from "@/lib/db/schema";
import { DAILY_ROLL_LOOKBACK_MS, DAILY_ROLL_MAX_SPAN_MS, decideDailyRoll, rollDailySimulators, rollSchemeOf } from "./daily-roll";

// 黄金発掘隊: ランキング 10/7〜10/11（ended_at = 10/11 23:59:59 JST）。シミュレーターは 10/7 00:00〜10/8 00:00 JST
const EVENT_ENDED_AT = new Date("2026-10-11T14:59:59.000Z");
const DAY1 = { startTime: new Date("2026-10-06T15:00:00.000Z"), endTime: new Date("2026-10-07T15:00:00.000Z") };
const GOLD_PREFIX = "limited-item-2026_10_gold_digger_1";
// 区分の自動判定待ち（ranking_type 空）の黄金発掘隊
const base = { id: "sim-gold", ...DAY1, rankingType: null as string | null, eventKind: "daily" as string | null, eventRankingPrefix: GOLD_PREFIX as string | null, eventEndedAt: EVENT_ENDED_AT, eventStatus: "open" as string | null };

// JST 境界
const OCT1 = new Date("2026-09-30T15:00:00.000Z");
const OCT11 = new Date("2026-10-10T15:00:00.000Z");
const OCT21 = new Date("2026-10-20T15:00:00.000Z");
const NOV1 = new Date("2026-10-31T15:00:00.000Z");
const NOV11 = new Date("2026-11-10T15:00:00.000Z");
const DEC1 = new Date("2026-11-30T15:00:00.000Z");
// WGP 10 月（ended_at = 10/31 23:59:59 JST・kind long）
const WGP_ENDED_AT = new Date("2026-10-31T14:59:59.000Z");
const wgp = { id: "sim-wgp", startTime: DAY1.startTime, endTime: DAY1.endTime, rankingType: "wgp-daily", eventKind: "long", eventRankingPrefix: "wgp", eventEndedAt: WGP_ENDED_AT, eventStatus: "open" };
// N-1（常設・whowatch_events の日付は「今月」= 10 月が入っている）
const n1 = { id: "sim-n1", startTime: OCT1, endTime: OCT11, rankingType: "n1-male", eventKind: "long", eventRankingPrefix: "n1", eventEndedAt: WGP_ENDED_AT, eventStatus: "open" };

describe("rollSchemeOf（期間の切り替え方）", () => {
  it("種別があればその種別、空なら紐付けイベントの prefix、それも無ければ kind = daily のときだけ日替わり", () => {
    expect(rollSchemeOf({ rankingType: `${GOLD_PREFIX}-2`, eventKind: "daily", eventRankingPrefix: GOLD_PREFIX })).toBe("daily");
    expect(rollSchemeOf({ rankingType: null, eventKind: "daily", eventRankingPrefix: GOLD_PREFIX })).toBe("daily");
    expect(rollSchemeOf({ rankingType: "wgp-daily", eventKind: "long", eventRankingPrefix: "wgp" })).toBe("daily");
    expect(rollSchemeOf({ rankingType: "wgp-overall", eventKind: "long", eventRankingPrefix: "wgp" })).toBe("monthly");
    expect(rollSchemeOf({ rankingType: "n1-male", eventKind: "long", eventRankingPrefix: "n1" })).toBe("n1round");
    expect(rollSchemeOf({ rankingType: null, eventKind: "long", eventRankingPrefix: "n1" })).toBe("n1round");
    expect(rollSchemeOf({ rankingType: "n1-total", eventKind: "long", eventRankingPrefix: "n1" })).toBe("monthly");
    // 期間が切り替わらない総合・従来の種別・区分なしのロングは進めない
    expect(rollSchemeOf({ rankingType: `${GOLD_PREFIX}-overall`, eventKind: "daily", eventRankingPrefix: GOLD_PREFIX })).toBeNull();
    expect(rollSchemeOf({ rankingType: "autumncollection_1st_overall", eventKind: "long", eventRankingPrefix: "autumncollection" })).toBeNull();
    expect(rollSchemeOf({ rankingType: null, eventKind: "long", eventRankingPrefix: "autumncollection" })).toBeNull();
    // 従来の種別が入っていれば kind = daily でも進めない（日替わりの種別ではない）
    expect(rollSchemeOf({ rankingType: "something_overall", eventKind: "daily", eventRankingPrefix: "something" })).toBeNull();
  });
});

describe("decideDailyRoll（日替わり）", () => {
  it("終了日時を過ぎていれば今日の 0:00〜翌 0:00 JST へ進める（10/8 00:03 JST → 10/8 の 1 日）", () => {
    expect(decideDailyRoll(base, new Date("2026-10-07T15:03:00.000Z"))).toEqual({ start: new Date("2026-10-07T15:00:00.000Z"), end: new Date("2026-10-08T15:00:00.000Z") });
  });

  it("グループが入っていても同じ", () => {
    expect(decideDailyRoll({ ...base, rankingType: `${GOLD_PREFIX}-2` }, new Date("2026-10-07T15:03:00.000Z"))?.end).toEqual(new Date("2026-10-08T15:00:00.000Z"));
  });

  it("同期が数日止まっていても、今日の区切りへ一気に進める", () => {
    expect(decideDailyRoll(base, new Date("2026-10-09T03:00:00.000Z"))).toEqual({ start: new Date("2026-10-08T15:00:00.000Z"), end: new Date("2026-10-09T15:00:00.000Z") });
  });

  it("まだ期間中なら進めない", () => {
    expect(decideDailyRoll(base, new Date("2026-10-07T14:59:00.000Z"))).toBeNull();
  });

  it("1 日ぶんより長い期間（利用者が全期間を設定）は動かさない", () => {
    expect(DAILY_ROLL_MAX_SPAN_MS).toBe(36 * 60 * 60 * 1000);
    expect(decideDailyRoll({ ...base, endTime: new Date("2026-10-11T15:00:00.000Z") }, new Date("2026-10-12T00:00:00.000Z"))).toBeNull();
  });

  it("イベントが終わっていれば進めない（最終日の翌 0:00 以降・closed）", () => {
    const lastDay = { ...base, startTime: new Date("2026-10-10T15:00:00.000Z"), endTime: new Date("2026-10-11T15:00:00.000Z") };
    expect(decideDailyRoll(lastDay, new Date("2026-10-11T15:05:00.000Z"))).toBeNull();
    expect(decideDailyRoll({ ...base, eventStatus: "closed" }, new Date("2026-10-07T15:03:00.000Z"))).toBeNull();
  });

  it("最終日は翌 0:00 ではなくイベントの終了で切る（同じ）。終了が分からなければ翌 0:00 まで", () => {
    const day4 = { ...base, startTime: new Date("2026-10-09T15:00:00.000Z"), endTime: new Date("2026-10-10T15:00:00.000Z") };
    expect(decideDailyRoll(day4, new Date("2026-10-10T15:03:00.000Z"))).toEqual({ start: new Date("2026-10-10T15:00:00.000Z"), end: new Date("2026-10-11T15:00:00.000Z") });
    expect(decideDailyRoll({ ...base, eventEndedAt: null }, new Date("2026-10-07T15:03:00.000Z"))?.end).toEqual(new Date("2026-10-08T15:00:00.000Z"));
  });
});

describe("decideDailyRoll（WGP・N-1）", () => {
  it("WGP デイリーはイベントが long（1 か月）でも日替わりで進める", () => {
    expect(decideDailyRoll(wgp, new Date("2026-10-07T15:03:00.000Z"))).toEqual({ start: new Date("2026-10-07T15:00:00.000Z"), end: new Date("2026-10-08T15:00:00.000Z") });
  });

  it("WGP デイリーの最終日（10/31）は翌月に進めない（イベントが終わる）", () => {
    const oct31 = { ...wgp, startTime: new Date("2026-10-30T15:00:00.000Z"), endTime: NOV1 };
    expect(decideDailyRoll(oct31, new Date("2026-10-31T15:03:00.000Z"))).toBeNull();
  });

  it("WGP 月間総合（1 か月）は月末で終わり、翌月に進めない（翌月は別の event_key）", () => {
    const overall = { ...wgp, rankingType: "wgp-overall", startTime: OCT1, endTime: NOV1 };
    expect(decideDailyRoll(overall, new Date("2026-10-31T15:03:00.000Z"))).toBeNull();
    // 期間中は動かない
    expect(decideDailyRoll(overall, new Date("2026-10-15T03:00:00.000Z"))).toBeNull();
  });

  it("N-1 の期間別は回の終わりで次の回へ（1 回目 → 2 回目: 10/11 0:00〜10/21 0:00）", () => {
    expect(decideDailyRoll(n1, new Date("2026-10-10T15:03:00.000Z"))).toEqual({ start: OCT11, end: OCT21 });
  });

  it("N-1 は常設なので、3 回目の後は whowatch_events の日付（今月）に関係なく翌月の 1 回目へ進む", () => {
    const third = { ...n1, startTime: OCT21, endTime: NOV1 };
    expect(decideDailyRoll(third, new Date("2026-10-31T15:03:00.000Z"))).toEqual({ start: NOV1, end: NOV11 });
  });

  it("N-1 の全期間（月間）は翌月へ進む", () => {
    const total = { ...n1, rankingType: "n1-total", startTime: OCT1, endTime: NOV1 };
    expect(decideDailyRoll(total, new Date("2026-10-31T15:03:00.000Z"))).toEqual({ start: NOV1, end: DEC1 });
  });

  it("N-1 で部門が自動判定待ち（ranking_type 空）でも回で進める", () => {
    expect(decideDailyRoll({ ...n1, rankingType: null }, new Date("2026-10-10T15:03:00.000Z"))).toEqual({ start: OCT11, end: OCT21 });
  });

  it("N-1 で利用者が長い期間（1 か月）を手で設定していれば動かさない", () => {
    expect(decideDailyRoll({ ...n1, startTime: OCT1, endTime: NOV1 }, new Date("2026-10-31T15:03:00.000Z"))).toBeNull();
  });

  it("従来の種別（autumncollection_1st_overall）は進めない", () => {
    expect(decideDailyRoll({ ...n1, rankingType: "autumncollection_1st_overall", eventRankingPrefix: "autumncollection" }, new Date("2026-10-10T15:03:00.000Z"))).toBeNull();
  });
});

type Row = Record<string, unknown>;
function fakeDb(rows: Row[], opts: { changed?: string[] } = {}) {
  const updates: Row[] = [];
  const db = {
    select: () => ({
      from: (table: unknown) => {
        expect(table).toBe(eventSimulators);
        const chain = { innerJoin: (t: unknown) => (expect(t).toBe(whowatchEvents), chain), where: async () => rows };
        return chain;
      },
    }),
    update: (table: unknown) => {
      expect(table).toBe(eventSimulators);
      return {
        set: (v: Row) => ({
          where: () => ({
            returning: async () => {
              updates.push(v);
              const id = rows[updates.length - 1]?.id as string;
              return opts.changed?.includes(id) ? [] : [{ id }];
            },
          }),
        }),
      };
    },
  };
  return { db: db as unknown as Parameters<typeof rollDailySimulators>[0], updates };
}

describe("rollDailySimulators", () => {
  const NOW = new Date("2026-10-07T15:03:00.000Z"); // 10/8 00:03 JST

  it("進めた行を返し、期間と更新日時を書く（長い期間の行は飛ばす）", async () => {
    const { db, updates } = fakeDb([base, { ...base, id: "sim-long", endTime: new Date("2026-10-11T15:00:00.000Z") }]);
    const r = await rollDailySimulators(db, NOW);
    expect(r.rolled).toEqual([{ id: "sim-gold", start: new Date("2026-10-07T15:00:00.000Z"), end: new Date("2026-10-08T15:00:00.000Z") }]);
    expect(updates).toEqual([{ startTime: new Date("2026-10-07T15:00:00.000Z"), endTime: new Date("2026-10-08T15:00:00.000Z"), updatedAt: NOW }]);
  });

  it("WGP デイリーと N-1 の回も同じ回で進める", async () => {
    const { db } = fakeDb([wgp, { ...n1, startTime: new Date("2026-09-30T15:00:00.000Z"), endTime: new Date("2026-10-07T15:00:00.000Z") }]);
    const r = await rollDailySimulators(db, NOW);
    expect(r.rolled.map((x) => x.id)).toEqual(["sim-wgp", "sim-n1"]);
    expect(r.rolled[0]).toMatchObject({ start: new Date("2026-10-07T15:00:00.000Z"), end: new Date("2026-10-08T15:00:00.000Z") });
    // 10/8 は 1 回目（1〜10 日）の途中なので、1 回目の区切り（10/1〜10/11 0:00）へ
    expect(r.rolled[1]).toMatchObject({ start: OCT1, end: OCT11 });
  });

  it("利用者がその間に期間を変えていたら（更新 0 行）rolled に入れない", async () => {
    const { db } = fakeDb([base], { changed: ["sim-gold"] });
    const r = await rollDailySimulators(db, NOW);
    expect(r.rolled).toEqual([]);
  });

  it("対象が無ければ何もしない。見る範囲は終了から 7 日以内", async () => {
    expect(DAILY_ROLL_LOOKBACK_MS).toBe(7 * 24 * 60 * 60 * 1000);
    const { db, updates } = fakeDb([]);
    expect(await rollDailySimulators(db, NOW)).toEqual({ rolled: [] });
    expect(updates).toEqual([]);
    vi.restoreAllMocks();
  });
});
