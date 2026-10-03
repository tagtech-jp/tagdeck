import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Supabase の getUser を差し替える。既定はログインしていない（またはログインが切れた）状態。
// h.written を入れると、getUser の中で Cookie を書く（期限間際の取り直し・壊れたログインの削除）
type Written = { name: string; value: string; options: Record<string, unknown> };
const h = vi.hoisted(() => ({ user: null as { id: string } | null, written: [] as Written[] }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, opts: { cookies: { setAll: (c: Written[]) => void } }) => ({
    auth: {
      getUser: async () => {
        if (h.written.length) opts.cookies.setAll(h.written);
        return { data: { user: h.user } };
      },
    },
  }),
}));

import { updateSession } from "./middleware";

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
});

const req = (path: string, method = "GET") => new NextRequest(new Request(`https://tagdeck.jp${path}`, { method }));

beforeEach(() => {
  h.user = null;
  h.written = [];
});

describe("updateSession（未ログイン）", () => {
  it.each(["/api/platforms/whowatch/live/poll", "/api/events", "/api/se/mappings"])(
    "API（%s）はログイン画面へ転送しない（各 API が 401 の JSON を返す）",
    async (path) => {
      const res = await updateSession(req(path, "POST"));
      expect(res.status).not.toBe(307);
      expect(res.headers.get("location")).toBeNull();
    },
  );

  it("画面（/live）は従来どおりログイン画面へ転送する", async () => {
    const res = await updateSession(req("/live"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/login");
  });

  it("公開ページ（/login）は転送しない", async () => {
    const res = await updateSession(req("/login"));
    expect(res.headers.get("location")).toBeNull();
  });

  it.each(["/sitemap.xml", "/robots.txt", "/terms", "/privacy", "/"])(
    "検索エンジン向けのファイルと規約・方針（%s）は未ログインでも転送しない",
    async (path) => {
      const res = await updateSession(req(path));
      expect(res.status).not.toBe(307);
      expect(res.headers.get("location")).toBeNull();
    },
  );

  it.each(["/termsx", "/privacy/edit", "/sitemap.xml.bak"])("公開の一覧に無いパス（%s）は従来どおり転送する", async (path) => {
    const res = await updateSession(req(path));
    expect(res.status).toBe(307);
  });
});

describe("updateSession（転送するときも書いた Cookie を載せる）", () => {
  const refreshed: Written[] = [
    { name: "sb-abc-auth-token.0", value: "new0", options: { path: "/", maxAge: 400 * 24 * 60 * 60, sameSite: "lax" } },
    { name: "sb-abc-auth-token.1", value: "new1", options: { path: "/", maxAge: 400 * 24 * 60 * 60, sameSite: "lax" } },
  ];
  const setCookieNames = (res: Response) =>
    (res.headers.getSetCookie?.() ?? []).map((c) => c.split("=")[0]).sort();

  it.each(["/", "/login"])("ログイン済みで %s に来たらダッシュボードへ。取り直した Cookie も載せる", async (path) => {
    h.user = { id: "u1" };
    h.written = refreshed;
    const res = await updateSession(req(path));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/dashboard");
    expect(setCookieNames(res)).toEqual(["sb-abc-auth-token.0", "sb-abc-auth-token.1"]);
  });

  it("ログインが壊れていてログイン画面へ送るときも、削除の Cookie を載せる（壊れた Cookie を残さない）", async () => {
    h.written = refreshed.map((c) => ({ ...c, value: "", options: { ...c.options, maxAge: 0 } }));
    const res = await updateSession(req("/live"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/login");
    expect(setCookieNames(res)).toEqual(["sb-abc-auth-token.0", "sb-abc-auth-token.1"]);
    expect((res.headers.getSetCookie?.() ?? []).every((c) => /Max-Age=0/i.test(c))).toBe(true);
  });

  it("ログイン済みで画面（/live）を開いたときは転送しない（取り直した Cookie はそのまま載る）", async () => {
    h.user = { id: "u1" };
    h.written = refreshed;
    const res = await updateSession(req("/live"));
    expect(res.headers.get("location")).toBeNull();
    expect(setCookieNames(res)).toEqual(["sb-abc-auth-token.0", "sb-abc-auth-token.1"]);
  });
});
