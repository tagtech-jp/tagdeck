import { beforeEach, describe, expect, it, vi } from "vitest";

// スマホアプリ（Capacitor）からの Authorization: Bearer でのログイン（2026-10-07）。Cookie 経路はこれまでどおり
const h = vi.hoisted(() => ({
  authorization: null as string | null,
  cookieRows: [{ name: "sb-x-auth-token", value: "cookie-session" }],
  created: [] as Array<{ url: string; key: string; opts: Record<string, unknown> }>,
  getUserCalls: [] as Array<string | undefined>,
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(h.authorization ? { authorization: h.authorization } : {}),
  cookies: async () => ({ getAll: () => h.cookieRows, set: () => undefined }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (url: string, key: string, opts: Record<string, unknown>) => {
    h.created.push({ url, key, opts });
    return {
      auth: {
        async getUser(jwt?: string) {
          h.getUserCalls.push(jwt);
          return { data: { user: { id: jwt ? `user-of-${jwt}` : "user-of-cookie" } } };
        },
      },
    };
  },
}));

import { bearerTokenOf, createClient } from "./server";

describe("bearerTokenOf", () => {
  it("Bearer の後ろのトークンを取り出す（大文字小文字・前後の空白は無視）", () => {
    expect(bearerTokenOf("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(bearerTokenOf("  bearer   tok  ")).toBe("tok");
    expect(bearerTokenOf("Basic xyz")).toBeNull();
    expect(bearerTokenOf("Bearer")).toBeNull();
    expect(bearerTokenOf("")).toBeNull();
    expect(bearerTokenOf(null)).toBeNull();
  });
});

describe("createClient", () => {
  beforeEach(() => {
    h.authorization = null;
    h.created.length = 0;
    h.getUserCalls.length = 0;
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "anon";
  });

  it("Authorization: Bearer があれば Cookie を見ず、そのトークンで本人確認し、PostgREST にも同じトークンを渡す", async () => {
    h.authorization = "Bearer tok.en.x";
    const client = await createClient();
    const opts = h.created[0].opts as { cookies: { getAll: () => unknown[] }; global?: { headers?: Record<string, string> } };
    expect(opts.cookies.getAll()).toEqual([]);
    expect(opts.global?.headers?.Authorization).toBe("Bearer tok.en.x");
    const { data } = await client.auth.getUser();
    expect(h.getUserCalls).toEqual(["tok.en.x"]);
    expect(data.user?.id).toBe("user-of-tok.en.x");
    // 明示的に別のトークンを渡せばそちら
    await client.auth.getUser("other");
    expect(h.getUserCalls[1]).toBe("other");
  });

  it("Bearer が無ければこれまでどおり Cookie（getAll は Cookie の行・global は付けない）", async () => {
    const client = await createClient();
    const opts = h.created[0].opts as { cookies: { getAll: () => unknown[] }; global?: unknown };
    expect(opts.cookies.getAll()).toEqual(h.cookieRows);
    expect(opts.global).toBeUndefined();
    const { data } = await client.auth.getUser();
    expect(h.getUserCalls).toEqual([undefined]);
    expect(data.user?.id).toBe("user-of-cookie");
  });

  it("Bearer 以外の Authorization（Basic 等）は Cookie 経路", async () => {
    h.authorization = "Basic abc";
    await createClient();
    expect((h.created[0].opts as { global?: unknown }).global).toBeUndefined();
  });
});
