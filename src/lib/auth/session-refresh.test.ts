import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  describeAuthCookies,
  isLoginExpiredResponse,
  needsRefresh,
  REFRESH_BEFORE_MS,
  refreshSessionIfNeeded,
  refreshSessionNow,
  SESSION_REFRESH_PATH,
} from "./session-refresh";

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

describe("describeAuthCookies（診断ログ用・値は出さない）", () => {
  it("分割されたログイン Cookie の番号と code-verifier の有無を出す", () => {
    expect(describeAuthCookies(["sb-abc-auth-token.0", "sb-abc-auth-token.1", "sb-abc-auth-token-code-verifier", "theme"])).toBe(
      "ログイン Cookie=0,1・code-verifier あり・Cookie 総数=4",
    );
  });
  it("分割なし・ログイン Cookie なしも区別する", () => {
    expect(describeAuthCookies(["sb-abc-auth-token"])).toBe("ログイン Cookie=分割なし・Cookie 総数=1");
    expect(describeAuthCookies(["_ga"])).toBe("ログイン Cookie=なし・Cookie 総数=1");
    expect(describeAuthCookies([])).toBe("ログイン Cookie=なし・Cookie 総数=0");
  });
});

describe("refreshSessionIfNeeded / refreshSessionNow（取り直しはサーバに頼む）", () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  let reply: () => Response | Promise<Response>;
  beforeEach(() => {
    calls.length = 0;
    reply = () => Response.json({ ok: true, refreshed: true, expires_at: 0 });
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return reply();
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refreshSessionIfNeeded はサーバの窓口へ POST するだけ（期限の判断はサーバ）", async () => {
    await refreshSessionIfNeeded();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(SESSION_REFRESH_PATH);
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.credentials).toBe("same-origin");
    expect(calls[0].init?.cache).toBe("no-store");
  });

  it("refreshSessionIfNeeded は通信が切れても投げない", async () => {
    reply = () => {
      throw new TypeError("Failed to fetch");
    };
    await expect(refreshSessionIfNeeded()).resolves.toBeUndefined();
  });

  it("refreshSessionNow は窓口へ POST し、ログインが生きていれば true", async () => {
    expect(await refreshSessionNow()).toBe(true);
    expect(calls[0].url).toBe(SESSION_REFRESH_PATH);
    expect(calls[0].init?.method).toBe("POST");
  });

  it("refreshSessionNow はログインが無い（401）・一時的な失敗（503）・通信断・壊れた応答なら false", async () => {
    reply = () => Response.json({ ok: false, reason: "no_session" }, { status: 401 });
    expect(await refreshSessionNow()).toBe(false);
    reply = () => Response.json({ ok: false, reason: "retryable" }, { status: 503 });
    expect(await refreshSessionNow()).toBe(false);
    reply = () => new Response("<!DOCTYPE html>", { status: 200 });
    expect(await refreshSessionNow()).toBe(false);
    reply = () => {
      throw new TypeError("Failed to fetch");
    };
    expect(await refreshSessionNow()).toBe(false);
  });
});
