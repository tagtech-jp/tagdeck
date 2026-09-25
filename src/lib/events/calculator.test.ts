import { describe, expect, it } from "vitest";
import { calculateExtendedForecast } from "./calculator";

const now = new Date("2026-09-25T12:00:00Z");
const base = {
  startTime: new Date("2026-09-23T00:00:00Z"),
  endTime: new Date("2026-09-28T00:00:00Z"),
  paceHistory: [] as Array<{ timestamp: Date; score: number }>,
};

describe("calculateExtendedForecast (ranking)", () => {
  it("ライバル情報が無いときは 100% にせず no_data を返す", () => {
    const f = calculateExtendedForecast({ ...base, eventType: "ranking", targetRank: 3, currentScore: 0 }, now);
    expect(f.status).toBe("no_data");
    expect(f.rankProbability).toBeUndefined();
    expect(f.expectedRank).toBeUndefined();
    expect(f.message).toContain("ランキング未取得");
  });

  it("ライバルがいれば従来どおり確率を返す", () => {
    const f = calculateExtendedForecast(
      {
        ...base,
        eventType: "ranking",
        targetRank: 1,
        currentScore: 10,
        rivals: [{ rank: 1, name: "A", score: 1_000_000 }],
      },
      now,
    );
    expect(f.status).not.toBe("no_data");
    expect(f.rankProbability).toBeDefined();
    expect(f.rankProbability!).toBeLessThan(5);
  });
});
