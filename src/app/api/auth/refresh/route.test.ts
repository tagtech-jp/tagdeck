import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// サーバ側の Supabase（getSession / refreshSession / getUser）と、届いた Cookie の名前を差し替える
type FakeSession = { access_token: string; refresh_token: string; expires_in: number; expires_at: number; token_type: string; user: unknown };
const h = vi.hoisted(() => ({
  session: null as FakeSession | null,
  sessionError: null as unknown,
  refreshResult: { data: { session: null as FakeSession | null }, error: null as unknown },
  refreshCalls: 0,
  user: { id: "u1" } as unknown,
  userCalls: 0,
  cookieNames: [] as string[],
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getSession: async () => ({ data: { session: h.session }, error: h.sessionError }),
      refreshSession: async () => {
        h.refreshCalls++;
        return h.refreshResult;
      },
      getUser: async () => {
        h.userCalls++;
        return { data: { user: h.user }, error: null };
      },
    },
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => h.cookieNames.map((name) => ({ name, value: "x" })) }),
}));

import { POST } from "./route";

const BASE = "https://tagdeck.jp/api/auth/refresh";
const call = (opts: { gotrue?: boolean; origin?: string } = {}) =>
  POST(
    new Request(opts.gotrue ? `${BASE}?format=gotrue` : BASE, {
      method: "POST",
      headers: opts.origin ? { origin: opts.origin } : {},
    }),
  );
const inMinutes = (m: number) => Math.round(Date.now() / 1000 + m * 60);
const sessionFor = (minutesLeft: number, tag = "old"): FakeSession => ({
  access_token: `at-${tag}`,
  refresh_token: `rt-${tag}`,
  expires_in: 3600,
  expires_at: inMinutes(minutesLeft),
  token_type: "bearer",
  user: { id: "u1" },
});

beforeEach(() => {
  h.session = null;
  h.sessionError = null;
  h.refreshCalls = 0;
  h.refreshResult = { data: { session: sessionFor(60, "new") }, error: null };
  h.user = { id: "u1" };
  h.userCalls = 0;
  h.cookieNames = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/auth/refresh（SessionKeeper・ライブ画面の 401 から）", () => {
  it("ログイン Cookie が無ければ 401（取り直さない）・診断ログに Cookie の名前の状態だけを出す", async () => {
    h.cookieNames = ["sb-abc-auth-token-code-verifier", "_ga"];
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, reason: "no_session" });
    expect(h.refreshCalls).toBe(0);
    expect(String(vi.mocked(console.warn).mock.calls[0]?.[0])).toContain("ログイン Cookie=なし・code-verifier あり・Cookie 総数=2");
  });

  it("期限まで 10 分以上あれば取り直さない（同じ要求の middleware が取り直した直後に 2 回目をしない）", async () => {
    h.session = sessionFor(30);
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, refreshed: false });
    expect(h.refreshCalls).toBe(0);
  });

  it("期限まで 10 分を切ったら取り直す", async () => {
    h.session = sessionFor(9);
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, refreshed: true });
    expect(h.refreshCalls).toBe(1);
  });

  it("取り直しを断られたら 401 と理由（Supabase のエラーコード）", async () => {
    h.session = sessionFor(5);
    h.refreshResult = {
      data: { session: null },
      error: { name: "AuthApiError", status: 400, code: "refresh_token_already_used", message: "Invalid Refresh Token: Already Used" },
    };
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, reason: "refresh_token_already_used" });
  });

  it("通信の一時的な失敗（status 0 / 5xx）は 503（ブラウザは次の確認でやり直す）", async () => {
    h.session = sessionFor(5);
    h.refreshResult = { data: { session: null }, error: { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" } };
    expect((await call()).status).toBe(503);
    h.refreshResult = { data: { session: null }, error: { name: "AuthApiError", status: 502, message: "Bad Gateway" } };
    expect((await call()).status).toBe(503);
  });

  it("getSession 自体がエラー（期限 90 秒前を切った自動の取り直しの失敗）も同じ扱い", async () => {
    h.sessionError = { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" };
    expect((await call()).status).toBe(503);
    h.sessionError = { name: "AuthApiError", status: 400, code: "refresh_token_not_found", message: "Invalid Refresh Token" };
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, reason: "refresh_token_not_found" });
  });

  it("応答はキャッシュさせず、トークンを返さない", async () => {
    h.session = sessionFor(5);
    const res = await call();
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["expires_at", "ok", "refreshed"]);
  });

  it("別のサイトからの呼び出しは 403（同じサイトなら通す）", async () => {
    h.session = sessionFor(5);
    expect((await call({ origin: "https://evil.example" })).status).toBe(403);
    expect(h.refreshCalls).toBe(0);
    expect((await call({ origin: "https://tagdeck.jp" })).status).toBe(200);
  });
});

describe("POST /api/auth/refresh?format=gotrue（ブラウザの supabase-js の取り直しを代わりに行う）", () => {
  it("取り直した新しいセッションを Supabase と同じ形で返す", async () => {
    h.session = sessionFor(1);
    const res = await call({ gotrue: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ access_token: "at-new", refresh_token: "rt-new", token_type: "bearer", expires_in: 3600, user: { id: "u1" } });
    expect(typeof body.expires_at).toBe("number");
    expect(h.refreshCalls).toBe(1);
  });

  it("期限が切れたあと（スリープ明け）でもサーバが取り直す", async () => {
    h.session = sessionFor(-30);
    const res = await call({ gotrue: true });
    expect(res.status).toBe(200);
    expect(h.refreshCalls).toBe(1);
  });

  it("この要求の middleware が取り直し済みなら、2 回目はせずにいまのセッションを返す（利用者は getUser で確かめたもの）", async () => {
    h.session = sessionFor(59, "fresh");
    h.user = { id: "u1", email: "checked@example.com" };
    const res = await call({ gotrue: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ access_token: "at-fresh", refresh_token: "rt-fresh", user: { email: "checked@example.com" } });
    expect(h.refreshCalls).toBe(0);
    expect(h.userCalls).toBe(1);
  });

  it("断られたら Supabase と同じ形のエラー（4xx）。supabase-js はログインを消してよい", async () => {
    h.session = sessionFor(1);
    h.refreshResult = {
      data: { session: null },
      error: { name: "AuthApiError", status: 400, code: "refresh_token_not_found", message: "Invalid Refresh Token: Refresh Token Not Found" },
    };
    const res = await call({ gotrue: true });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" });
  });

  it("一時的な失敗は 503（supabase-js はログイン Cookie を消さずに再試行する）", async () => {
    h.session = sessionFor(1);
    h.refreshResult = { data: { session: null }, error: { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" } };
    const res = await call({ gotrue: true });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error_code: "retryable" });
  });

  it("ログイン Cookie が無ければ 401（Supabase と同じ形）", async () => {
    const res = await call({ gotrue: true });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error_code: "no_session" });
  });
});
