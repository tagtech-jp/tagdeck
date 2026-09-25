import { describe, expect, it } from "vitest";
import { INITIAL_MASTER_STATE, masterFailed, masterRetryDelay, MASTER_RETRY_DELAYS_MS, masterSucceeded, retryCountdownSec } from "./master-retry";

const NOW = 1_800_000_000_000;

describe("masterRetryDelay", () => {
  it("5秒 → 15秒 → 45秒 → 120秒 → 300秒 と伸びる", () => {
    expect([1, 2, 3, 4, 5].map(masterRetryDelay)).toEqual([...MASTER_RETRY_DELAYS_MS]);
  });

  it("上限に達したら以後は 300 秒のまま（回数の上限は設けない）", () => {
    expect(masterRetryDelay(6)).toBe(300_000);
    expect(masterRetryDelay(100)).toBe(300_000);
  });
});

describe("MasterState", () => {
  it("失敗を重ねるとカウンタが増え、次のリトライ時刻が伸びる", () => {
    let s = masterFailed(INITIAL_MASTER_STATE, NOW);
    expect(s).toEqual({ ready: false, failureCount: 1, nextRetryAt: NOW + 5_000 });
    s = masterFailed(s, NOW + 5_000);
    expect(s).toEqual({ ready: false, failureCount: 2, nextRetryAt: NOW + 5_000 + 15_000 });
    s = masterFailed(s, NOW + 20_000);
    expect(s.failureCount).toBe(3);
    expect(s.nextRetryAt).toBe(NOW + 20_000 + 45_000);
  });

  it("成功したらリトライを止めてカウンタが戻る", () => {
    const failed = masterFailed(masterFailed(INITIAL_MASTER_STATE, NOW), NOW + 5_000);
    expect(masterSucceeded()).toEqual({ ready: true, failureCount: 0, nextRetryAt: null });
    expect(failed.failureCount).toBe(2); // 元の状態は変えない（純関数）
  });

  it("復帰後に再び失敗したら、また 5 秒から始まる", () => {
    const recovered = masterSucceeded();
    expect(masterFailed(recovered, NOW).nextRetryAt).toBe(NOW + 5_000);
  });

  it("残り秒は切り上げ、正常時は null", () => {
    const s = masterFailed(INITIAL_MASTER_STATE, NOW);
    expect(retryCountdownSec(s, NOW)).toBe(5);
    expect(retryCountdownSec(s, NOW + 4_100)).toBe(1);
    expect(retryCountdownSec(s, NOW + 9_000)).toBe(0); // 過ぎても負にはしない
    expect(retryCountdownSec(masterSucceeded(), NOW)).toBeNull();
  });
});
