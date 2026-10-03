import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  session: null as { expires_at?: number } | null,
  refreshResult: { data: { session: { expires_at: 0 } as unknown }, error: null as unknown },
  refreshCalls: 0,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: h.session } }),
      refreshSession: async () => {
        h.refreshCalls++;
        return h.refreshResult;
      },
    },
  }),
}));

import { isLoginExpiredResponse, needsRefresh, REFRESH_BEFORE_MS, refreshSessionIfNeeded, refreshSessionNow } from "./session-refresh";

const NOW = 1_790_000_000_000;

describe("needsRefresh（期限より前に取り直す）", () => {
  it("残りが 10 分を切ったら取り直す", () => {
    expect(needsRefresh((NOW + REFRESH_BEFORE_MS - 1) / 1000, NOW)).toBe(true);
    expect(needsRefresh((NOW - 1) / 1000, NOW)).toBe(true); // 期限切れ
  });
  it("残りが 10 分以上なら取り直さない", () => {
    expect(needsRefresh((NOW + REFRESH_BEFORE_MS + 1000) / 1000, NOW)).toBe(false);
  });
  it("期限が分からなければ何もしない", () => {
    expect(needsRefresh(undefined, NOW)).toBe(false);
    expect(needsRefresh(null, NOW)).toBe(false);
    expect(needsRefresh(Number.NaN, NOW)).toBe(false);
  });
});

describe("isLoginExpiredResponse（ログイン切れの応答か）", () => {
  it("401 はログイン切れ", () => {
    expect(isLoginExpiredResponse({ status: 401, redirected: false, url: "https://tagdeck.jp/api/platforms/whowatch/live/poll" })).toBe(true);
  });
  it("ログイン画面へ転送された応答（旧版の middleware）はログイン切れ", () => {
    expect(isLoginExpiredResponse({ status: 200, redirected: true, url: "https://tagdeck.jp/login?redirect=%2Fapi%2Fplatforms%2Fwhowatch%2Flive%2Fpoll" })).toBe(true);
  });
  it("通常の成功・ほかのエラーはログイン切れではない", () => {
    expect(isLoginExpiredResponse({ status: 200, redirected: false, url: "https://tagdeck.jp/api/platforms/whowatch/live/poll" })).toBe(false);
    expect(isLoginExpiredResponse({ status: 500, redirected: false, url: "https://tagdeck.jp/api/platforms/whowatch/live/poll" })).toBe(false);
    expect(isLoginExpiredResponse({ status: 200, redirected: true, url: "https://tagdeck.jp/live" })).toBe(false);
  });
});

describe("refreshSessionIfNeeded / refreshSessionNow", () => {
  beforeEach(() => {
    h.refreshCalls = 0;
    h.session = null;
    h.refreshResult = { data: { session: { expires_at: 0 } }, error: null };
  });

  it("期限が近いときだけ取り直す", async () => {
    h.session = { expires_at: (Date.now() + 60_000) / 1000 };
    await refreshSessionIfNeeded();
    expect(h.refreshCalls).toBe(1);
    h.session = { expires_at: (Date.now() + 50 * 60_000) / 1000 };
    await refreshSessionIfNeeded();
    expect(h.refreshCalls).toBe(1);
  });

  it("ログインしていなければ取り直さない", async () => {
    await refreshSessionIfNeeded();
    expect(h.refreshCalls).toBe(0);
  });

  it("refreshSessionNow は取り直せたら true、エラーなら false", async () => {
    expect(await refreshSessionNow()).toBe(true);
    h.refreshResult = { data: { session: null }, error: new Error("Invalid Refresh Token") };
    expect(await refreshSessionNow()).toBe(false);
  });
});
