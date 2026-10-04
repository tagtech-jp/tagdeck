import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthClient } from "@supabase/supabase-js";

// 本物の supabase-js（auth-js）で、「取り直しを自分のサーバへ回す」つなぎ目を確かめる（2026-10-03）。
// supabase-js → fetchWithServerRefresh → /api/auth/refresh?format=gotrue（本物の route）→ 差し替えたサーバ側 Supabase
// - 成功: supabase-js が窓口の応答をセッションとして保存する
// - 一時的な失敗（503）: supabase-js はログインを消さない（本番で起きていた「Cookie が消える」が起きない）
// - Supabase に断られた（400）: supabase-js はログインを消す（本当に無効なログインは残さない）
type FakeSession = { access_token: string; refresh_token: string; expires_in: number; expires_at: number; token_type: string; user: unknown };
const h = vi.hoisted(() => ({
  serverSession: null as FakeSession | null,
  refreshResult: { data: { session: null as FakeSession | null }, error: null as unknown },
  supabaseCalls: [] as string[],
  routeCalls: 0,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getSession: async () => ({ data: { session: h.serverSession }, error: null }),
      refreshSession: async () => h.refreshResult,
      getUser: async () => ({ data: { user: { id: "u1" } }, error: null }),
    },
  }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [] }) }));

import { fetchWithServerRefresh } from "./client";
import { POST } from "@/app/api/auth/refresh/route";

const KEY = "sb-test-auth-token";
const now = () => Math.round(Date.now() / 1000);
const session = (tag: string, expiresAt: number): FakeSession => ({
  access_token: `at-${tag}`,
  refresh_token: `rt-${tag}`,
  expires_in: 3600,
  expires_at: expiresAt,
  token_type: "bearer",
  user: { id: "u1", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" },
});

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => void m.set(k, v),
    removeItem: async (k: string) => void m.delete(k),
  };
}

beforeEach(() => {
  h.supabaseCalls = [];
  h.routeCalls = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  // 自分のサーバの窓口は本物の route を呼ぶ。Supabase へ直接行く要求は記録だけして 500 を返す（来てはいけない）
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.startsWith("/api/auth/refresh")) {
      h.routeCalls++;
      return POST(new Request(`https://tagdeck.jp${url}`, { method: init?.method ?? "GET" }));
    }
    h.supabaseCalls.push(url);
    return new Response("{}", { status: 500 });
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function clientWith(stored: FakeSession) {
  const storage = memoryStorage();
  storage.m.set(KEY, JSON.stringify(stored));
  const client = new AuthClient({
    url: "https://abcdefghijklmnop.supabase.co/auth/v1",
    storageKey: KEY,
    storage,
    autoRefreshToken: false,
    persistSession: true,
    detectSessionInUrl: false,
    fetch: fetchWithServerRefresh,
  });
  await client.initialize();
  return { client, storage };
}

describe("supabase-js の取り直し → 自分のサーバの窓口（本物の supabase-js で確認）", () => {
  it("期限切れのセッションを読むと、窓口が取り直した新しいセッションを保存する（Supabase へは直接行かない）", async () => {
    const expired = session("old", now() - 60);
    h.serverSession = expired;
    h.refreshResult = { data: { session: session("new", now() + 3600) }, error: null };
    const { client, storage } = await clientWith(expired);
    const { data, error } = await client.getSession();
    expect(error).toBeNull();
    expect(data.session?.access_token).toBe("at-new");
    expect(JSON.parse(storage.m.get(KEY) ?? "{}").refresh_token).toBe("rt-new");
    expect(h.routeCalls).toBe(1);
    expect(h.supabaseCalls).toEqual([]);
  });

  it("窓口が 503（一時的な失敗）なら、何度か再試行したあともログインを消さない", async () => {
    vi.useFakeTimers({ now: Date.now() });
    const expired = session("old", now() - 60);
    h.serverSession = expired;
    h.refreshResult = { data: { session: null }, error: { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" } };
    const { client, storage } = await clientWith(expired);
    const pending = client.getSession();
    await vi.runAllTimersAsync();
    const { data, error } = await pending;
    expect(data.session).toBeNull();
    expect(error?.name).toBe("AuthRetryableFetchError");
    expect(h.routeCalls).toBeGreaterThan(1);
    expect(storage.m.has(KEY)).toBe(true);
    expect(h.supabaseCalls).toEqual([]);
  });

  it("Supabase に断られた（400）ときはログインを消す（本当に無効なログインは残さない）", async () => {
    const expired = session("old", now() - 60);
    h.serverSession = expired;
    h.refreshResult = {
      data: { session: null },
      error: { name: "AuthApiError", status: 400, code: "refresh_token_not_found", message: "Invalid Refresh Token: Refresh Token Not Found" },
    };
    const { client, storage } = await clientWith(expired);
    const { data, error } = await client.getSession();
    expect(data.session).toBeNull();
    expect(error?.message).toContain("Refresh Token Not Found");
    expect(storage.m.has(KEY)).toBe(false);
  });

  it("期限まで十分あるセッションは、窓口にも Supabase にも問い合わせずにそのまま使う", async () => {
    const fresh = session("fresh", now() + 3000);
    const { client } = await clientWith(fresh);
    const { data } = await client.getSession();
    expect(data.session?.access_token).toBe("at-fresh");
    expect(h.routeCalls).toBe(0);
    expect(h.supabaseCalls).toEqual([]);
  });
});
