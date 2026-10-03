import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// サーバ側の Supabase（getSession / refreshSession）と、届いた Cookie の名前を差し替える
const h = vi.hoisted(() => ({
  session: null as { expires_at?: number } | null,
  sessionError: null as unknown,
  refreshResult: { data: { session: null as { expires_at?: number } | null }, error: null as unknown },
  refreshCalls: 0,
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
    },
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => h.cookieNames.map((name) => ({ name, value: "x" })) }),
}));

import { POST } from "./route";

const URL = "https://tagdeck.jp/api/auth/refresh";
const call = (force = false) => POST(new Request(force ? `${URL}?force=1` : URL, { method: "POST" }));
const inMinutes = (m: number) => Date.now() / 1000 + m * 60;

describe("POST /api/auth/refresh（ログインの取り直しはサーバが行う）", () => {
  beforeEach(() => {
    h.session = null;
    h.sessionError = null;
    h.refreshCalls = 0;
    h.refreshResult = { data: { session: { expires_at: inMinutes(60) } }, error: null };
    h.cookieNames = [];
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ログイン Cookie が無ければ 401（取り直さない）・診断ログに Cookie の名前の状態だけを出す", async () => {
    h.cookieNames = ["sb-abc-auth-token-code-verifier", "_ga"];
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, reason: "no_session" });
    expect(h.refreshCalls).toBe(0);
    expect(String(vi.mocked(console.warn).mock.calls[0]?.[0])).toContain("ログイン Cookie=なし・code-verifier あり・Cookie 総数=2");
  });

  it("期限まで 10 分以上あれば取り直さない", async () => {
    h.session = { expires_at: inMinutes(30) };
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, refreshed: false });
    expect(h.refreshCalls).toBe(0);
  });

  it("期限まで 10 分を切ったら取り直す", async () => {
    h.session = { expires_at: inMinutes(9) };
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, refreshed: true });
    expect(h.refreshCalls).toBe(1);
  });

  it("force=1（ライブ画面が 401 を受けたとき）は期限に関係なく取り直す", async () => {
    h.session = { expires_at: inMinutes(50) };
    const res = await call(true);
    expect(res.status).toBe(200);
    expect(h.refreshCalls).toBe(1);
  });

  it("取り直しを断られたら 401 と理由（Supabase のエラーコード）", async () => {
    h.session = { expires_at: inMinutes(5) };
    h.refreshResult = {
      data: { session: null },
      error: { name: "AuthApiError", status: 400, code: "refresh_token_already_used", message: "Invalid Refresh Token: Already Used" },
    };
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, reason: "refresh_token_already_used" });
  });

  it("通信の一時的な失敗（status 0 / 5xx）は 503（ブラウザは次の確認でやり直す）", async () => {
    h.session = { expires_at: inMinutes(5) };
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

  it("応答はキャッシュさせない（トークンを返さない）", async () => {
    h.session = { expires_at: inMinutes(5) };
    const res = await call();
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["expires_at", "ok", "refreshed"]);
  });
});
