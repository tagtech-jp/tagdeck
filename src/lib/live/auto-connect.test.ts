import { describe, expect, it } from "vitest";
import { idlePollInterval, IDLE_ESCALATE_AFTER_MS, IDLE_POLL_INTERVAL_MS, INITIAL_AUTO_CONNECT_STATE, reduceAutoConnect, type AutoConnectState } from "./auto-connect";

const NOW = 1_800_000_000_000;

describe("idlePollInterval", () => {
  it("待機開始から 30 分までは 30 秒", () => {
    expect(idlePollInterval(0)).toBe(IDLE_POLL_INTERVAL_MS.base);
    expect(idlePollInterval(IDLE_ESCALATE_AFTER_MS.toMinute)).toBe(IDLE_POLL_INTERVAL_MS.base);
  });

  it("30 分を過ぎたら 60 秒", () => {
    expect(idlePollInterval(IDLE_ESCALATE_AFTER_MS.toMinute + 1)).toBe(IDLE_POLL_INTERVAL_MS.after30min);
    expect(idlePollInterval(IDLE_ESCALATE_AFTER_MS.toFiveMinutes)).toBe(IDLE_POLL_INTERVAL_MS.after30min);
  });

  it("2 時間を過ぎたら 5 分", () => {
    expect(idlePollInterval(IDLE_ESCALATE_AFTER_MS.toFiveMinutes + 1)).toBe(IDLE_POLL_INTERVAL_MS.after2h);
    expect(idlePollInterval(24 * 60 * 60_000)).toBe(IDLE_POLL_INTERVAL_MS.after2h);
  });
});

describe("reduceAutoConnect（待機 → 配信検知 → 接続 → 配信終了 → 待機）", () => {
  it("一連の流れをたどる", () => {
    let s: AutoConnectState = INITIAL_AUTO_CONNECT_STATE;
    expect(s.phase).toBe("off");

    s = reduceAutoConnect(s, { type: "enable", now: NOW });
    expect(s).toEqual({ phase: "waiting", waitingStartedAt: NOW });

    s = reduceAutoConnect(s, { type: "live_detected" });
    expect(s.phase).toBe("connecting");

    s = reduceAutoConnect(s, { type: "connected" });
    expect(s.phase).toBe("connected");

    // 配信終了 → 待機へ戻り、待機開始時刻がリセットされる（間隔も base に戻る）
    s = reduceAutoConnect(s, { type: "disconnected", now: NOW + 3_600_000 });
    expect(s).toEqual({ phase: "waiting", waitingStartedAt: NOW + 3_600_000 });
    expect(idlePollInterval(0)).toBe(IDLE_POLL_INTERVAL_MS.base);
  });

  it("OFF にしたら待機を打ち切る", () => {
    const waiting: AutoConnectState = { phase: "waiting", waitingStartedAt: NOW };
    expect(reduceAutoConnect(waiting, { type: "disable" })).toEqual(INITIAL_AUTO_CONNECT_STATE);
    const connected: AutoConnectState = { phase: "connected", waitingStartedAt: null };
    expect(reduceAutoConnect(connected, { type: "disable" })).toEqual(INITIAL_AUTO_CONNECT_STATE);
  });

  it("自動接続 OFF のまま切断しても待機へは戻らない（手動で止めたら止まったまま）", () => {
    expect(reduceAutoConnect(INITIAL_AUTO_CONNECT_STATE, { type: "disconnected", now: NOW })).toEqual(INITIAL_AUTO_CONNECT_STATE);
  });

  it("待機中に手動で接続した場合も connected になる", () => {
    const waiting: AutoConnectState = { phase: "waiting", waitingStartedAt: NOW };
    expect(reduceAutoConnect(waiting, { type: "connected" }).phase).toBe("connected");
  });

  it("待機していないのに配信検知が来ても何も起きない", () => {
    expect(reduceAutoConnect(INITIAL_AUTO_CONNECT_STATE, { type: "live_detected" })).toEqual(INITIAL_AUTO_CONNECT_STATE);
  });

  it("接続に失敗して待機へ戻るときも待機開始時刻が入る", () => {
    const connecting: AutoConnectState = { phase: "connecting", waitingStartedAt: null };
    expect(reduceAutoConnect(connecting, { type: "disconnected", now: NOW + 5_000 })).toEqual({ phase: "waiting", waitingStartedAt: NOW + 5_000 });
  });
});
