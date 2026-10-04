import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithServerRefresh, isRefreshTokenRequest } from "./client";
import { SESSION_REFRESH_PATH } from "@/lib/auth/session-refresh";

const SUPABASE = "https://abcdefghijklmnop.supabase.co";

describe("isRefreshTokenRequest（supabase-js の要求がログインの取り直しか）", () => {
  it("POST /auth/v1/token?grant_type=refresh_token は取り直し", () => {
    expect(isRefreshTokenRequest(`${SUPABASE}/auth/v1/token?grant_type=refresh_token`)).toBe(true);
  });
  it("ログイン時のコード交換・利用者の確認・DB の読み書きは取り直しではない", () => {
    expect(isRefreshTokenRequest(`${SUPABASE}/auth/v1/token?grant_type=pkce`)).toBe(false);
    expect(isRefreshTokenRequest(`${SUPABASE}/auth/v1/user`)).toBe(false);
    expect(isRefreshTokenRequest(`${SUPABASE}/rest/v1/event_history?select=*`)).toBe(false);
    expect(isRefreshTokenRequest("not a url")).toBe(false);
  });
});

describe("fetchWithServerRefresh（取り直しだけ自分のサーバへ回す）", () => {
  const calls: { input: unknown; init?: RequestInit }[] = [];
  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response("{}");
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("取り直しは Supabase へ送らず、窓口（?format=gotrue）へ POST する", async () => {
    await fetchWithServerRefresh(`${SUPABASE}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      body: JSON.stringify({ refresh_token: "rt" }),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe(`${SESSION_REFRESH_PATH}?format=gotrue`);
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.credentials).toBe("same-origin");
    // 更新トークンは本文で送らない（サーバは自分が受け取った Cookie の更新トークンを使う）
    expect(calls[0].init?.body).toBeUndefined();
  });

  it("URL オブジェクトや Request で渡されても見分ける", async () => {
    await fetchWithServerRefresh(new URL(`${SUPABASE}/auth/v1/token?grant_type=refresh_token`), { method: "POST" });
    await fetchWithServerRefresh(new Request(`${SUPABASE}/auth/v1/token?grant_type=refresh_token`, { method: "POST" }));
    expect(calls.map((c) => c.input)).toEqual([`${SESSION_REFRESH_PATH}?format=gotrue`, `${SESSION_REFRESH_PATH}?format=gotrue`]);
  });

  it("それ以外の要求はそのまま送る", async () => {
    const init = { method: "GET", headers: { apikey: "k" } };
    await fetchWithServerRefresh(`${SUPABASE}/auth/v1/user`, init);
    expect(calls[0].input).toBe(`${SUPABASE}/auth/v1/user`);
    expect(calls[0].init).toBe(init);
  });
});
