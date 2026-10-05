import { describe, expect, it } from "vitest";
import { computeRankStatus, type RankEntryLite, type RankSnapshotLite } from "./rank-alert";

const e = (rank: number, point: number, name: string): RankEntryLite => ({ rank, point, user_id: name, user_path: null, name });
const snap = (min: number, myRank: number | null, myPoint: number | null, entries: RankEntryLite[]): RankSnapshotLite => ({ capturedAt: new Date(Date.UTC(2026, 9, 5, 12, min)), myRank, myPoint, entries });

describe("computeRankStatus", () => {
  it("上下との差と目標までの差を出す", () => {
    const s = computeRankStatus(snap(0, 3, 5000, [e(2, 6000, "A"), e(3, 5000, "me"), e(4, 4000, "B")]), null, 2);
    expect(s).toMatchObject({ myRank: 3, above: { name: "A", gap: 1000 }, below: { name: "B", gap: 1000, closingPerHour: null }, target: { rank: 2, gap: 1000 }, alerts: [] });
  });

  it("目標圏内なら gap は 1 つ外の人との差（負＝余裕）", () => {
    const s = computeRankStatus(snap(0, 2, 6000, [e(1, 9000, "A"), e(2, 6000, "me"), e(3, 5500, "B")]), null, 2);
    expect(s?.target).toEqual({ rank: 2, gap: -500 });
  });

  it("下の人が 30 分以内に追いつくペースなら追い上げ警告", () => {
    const prev = snap(0, 3, 5000, [e(3, 5000, "me"), e(4, 3000, "B")]);
    const latest = snap(5, 3, 5000, [e(3, 5000, "me"), e(4, 4000, "B")]); // 5 分で 1000pt 詰めた → 残り 1000pt は約 5 分
    const s = computeRankStatus(latest, prev, null);
    expect(s?.below).toMatchObject({ gap: 1000, closingPerHour: 12000, etaMinutes: 5 });
    expect(s?.alerts.map((a) => a.kind)).toEqual(["chase"]);
  });

  it("詰めていても 30 分より先なら警告しない・別人に入れ替わったらペースを出さない", () => {
    const slow = computeRankStatus(snap(5, 3, 5000, [e(3, 5000, "me"), e(4, 3000, "B")]), snap(0, 3, 5000, [e(3, 5000, "me"), e(4, 2900, "B")]), null);
    expect(slow?.below?.etaMinutes).toBe(100);
    expect(slow?.alerts).toEqual([]);
    const swapped = computeRankStatus(snap(5, 3, 5000, [e(3, 5000, "me"), e(4, 4900, "C")]), snap(0, 3, 5000, [e(3, 5000, "me"), e(4, 1000, "B")]), null);
    expect(swapped?.below?.closingPerHour).toBeNull();
    expect(swapped?.alerts).toEqual([]);
  });

  it("同期が止まって間隔が空いたらペースは出さない", () => {
    const s = computeRankStatus(snap(59, 3, 5000, [e(3, 5000, "me"), e(4, 4900, "B")]), snap(0, 3, 5000, [e(3, 5000, "me"), e(4, 1000, "B")]), null);
    expect(s?.below?.closingPerHour).toBeNull();
  });

  it("順位が下がったら抜かれた警告、目標圏から外れたら目標割れ警告", () => {
    const prev = snap(0, 2, 5000, [e(2, 5000, "me"), e(3, 4900, "B")]);
    const latest = snap(5, 3, 5100, [e(2, 5300, "B"), e(3, 5100, "me")]);
    const s = computeRankStatus(latest, prev, 2);
    expect(s?.alerts.map((a) => a.kind)).toEqual(["overtaken", "target_lost"]);
    expect(s?.target).toEqual({ rank: 2, gap: 200 });
  });

  it("自分の順位が取れていなければ null", () => {
    expect(computeRankStatus(snap(0, null, null, [e(1, 100, "A")]), null, 1)).toBeNull();
  });
});
