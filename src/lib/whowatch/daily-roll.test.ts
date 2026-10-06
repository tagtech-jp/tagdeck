import { describe, expect, it, vi } from "vitest";
import { eventSimulators, whowatchEvents } from "@/lib/db/schema";
import { DAILY_ROLL_MAX_SPAN_MS, decideDailyRoll, rollDailySimulators } from "./daily-roll";

// 黄金発掘隊: ランキング 10/7〜10/11（ended_at = 10/11 23:59:59 JST）。シミュレーターは 10/7 00:00〜10/8 00:00 JST
const EVENT_ENDED_AT = new Date("2026-10-11T14:59:59.000Z");
const DAY1 = { startTime: new Date("2026-10-06T15:00:00.000Z"), endTime: new Date("2026-10-07T15:00:00.000Z") };
const base = { id: "sim-gold", ...DAY1, eventEndedAt: EVENT_ENDED_AT, eventStatus: "open" as string | null };

describe("decideDailyRoll", () => {
  it("終了日時を過ぎていれば今日の 0:00〜翌 0:00 JST へ進める（10/8 00:03 JST → 10/8 の 1 日）", () => {
    expect(decideDailyRoll(base, new Date("2026-10-07T15:03:00.000Z"))).toEqual({ start: new Date("2026-10-07T15:00:00.000Z"), end: new Date("2026-10-08T15:00:00.000Z") });
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

  it("進めた行を返し、期間と更新日時を書く", async () => {
    const { db, updates } = fakeDb([base, { ...base, id: "sim-long", endTime: new Date("2026-10-11T15:00:00.000Z") }]);
    const r = await rollDailySimulators(db, NOW);
    expect(r.rolled).toEqual([{ id: "sim-gold", start: new Date("2026-10-07T15:00:00.000Z"), end: new Date("2026-10-08T15:00:00.000Z") }]);
    expect(updates).toEqual([{ startTime: new Date("2026-10-07T15:00:00.000Z"), endTime: new Date("2026-10-08T15:00:00.000Z"), updatedAt: NOW }]);
  });

  it("利用者がその間に期間を変えていたら（更新 0 行）rolled に入れない", async () => {
    const { db } = fakeDb([base], { changed: ["sim-gold"] });
    const r = await rollDailySimulators(db, NOW);
    expect(r.rolled).toEqual([]);
  });

  it("対象が無ければ何もしない", async () => {
    const { db, updates } = fakeDb([]);
    expect(await rollDailySimulators(db, NOW)).toEqual({ rolled: [] });
    expect(updates).toEqual([]);
    vi.restoreAllMocks();
  });
});
