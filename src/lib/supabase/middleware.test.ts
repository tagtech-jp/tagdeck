import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ログインしていない（またはログインが切れた）状態の Supabase を返す
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

import { updateSession } from "./middleware";

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
});

const req = (path: string, method = "GET") => new NextRequest(new Request(`https://tagdeck.jp${path}`, { method }));

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
