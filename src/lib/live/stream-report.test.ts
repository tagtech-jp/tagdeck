import { describe, expect, it } from "vitest";
import { summarizeStream, type StreamGiftRow } from "./stream-report";

const at = (min: number) => new Date(Date.UTC(2026, 9, 5, 12, min));
const row = (min: number, listenerId: string | null, name: string | null, itemName: string, count: number, totalYen: number | null): StreamGiftRow => ({ occurredAt: at(min), listenerId, name, itemName, count, totalYen });

describe("summarizeStream", () => {
  const rows = [
    row(0, "a", "あい", "花火", 1, 1000),
    row(3, "b", "びー", "ぶたさん", 3, 480),
    row(5, null, null, "花火", 1, 1000),
    row(30, "a", "あい", "花火", 2, 2000),
    row(32, "a", "あい", "風船", 10, 100),
    row(35, "c", "しー", "どんぐり", 3, null),
  ];
  const first = new Map([["a", at(-60 * 24)], ["b", at(3)], ["c", at(35)]]);

  it("合計・人数・匿名・上位を出す", () => {
    const r = summarizeStream(rows, first)!;
    expect(r).toMatchObject({ giftCount: 6, totalYen: 4580, giverCount: 3, anonymousGiftCount: 1, startedAt: at(0).toISOString(), endedAt: at(35).toISOString() });
    expect(r.topGivers).toEqual([
      { name: "あい", totalYen: 3100, gifts: 3 },
      { name: "びー", totalYen: 480, gifts: 1 },
      { name: "しー", totalYen: 0, gifts: 1 },
    ]);
    expect(r.topItems[0]).toEqual({ name: "花火", count: 4, totalYen: 4000 });
  });

  it("この配信で初めて投げた人を出す（前から投げている人は出さない）", () => {
    expect(summarizeStream(rows, first)!.firstTimers.sort()).toEqual(["しー", "びー"]);
  });

  it("金額が最も多い 10 分間を出す", () => {
    const r = summarizeStream(rows, first)!;
    expect(r.peak).toMatchObject({ from: at(0).toISOString(), to: at(10).toISOString(), totalYen: 2480, gifts: 3 });
  });

  it("ギフトが無ければ null", () => {
    expect(summarizeStream([], new Map())).toBeNull();
  });
});
