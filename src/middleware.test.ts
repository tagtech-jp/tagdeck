import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// スマホアプリ（Capacitor）からの API 呼び出しに CORS を付け、事前確認（OPTIONS）に 204 を返す（2026-10-07）
const updateSessionMock = vi.fn(async (_request: NextRequest) => NextResponse.next());
vi.mock("@/lib/supabase/middleware", () => ({ updateSession: (request: NextRequest) => updateSessionMock(request) }));

import { middleware } from "./middleware";

const req = (path: string, init: { method?: string; origin?: string } = {}) =>
  new NextRequest(new Request(`https://tagdeck.jp${path}`, { method: init.method ?? "GET", headers: init.origin ? { origin: init.origin } : {} }));

describe("middleware の CORS（/api/* × 許可した Origin）", () => {
  beforeEach(() => {
    updateSessionMock.mockClear();
  });

  it("許可した Origin からの OPTIONS は 204 で CORS ヘッダーを返し、ログインの確認（Supabase）には行かない", async () => {
    const res = await middleware(req("/api/platforms/whowatch/live", { method: "OPTIONS", origin: "https://localhost" }));
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://localhost");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    expect(updateSessionMock).not.toHaveBeenCalled();
  });

  it("許可した Origin からの GET は従来の処理（updateSession）を通し、応答に CORS ヘッダーを足す", async () => {
    const res = await middleware(req("/api/events", { origin: "capacitor://localhost" }));
    expect(updateSessionMock).toHaveBeenCalledTimes(1);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("capacitor://localhost");
    expect(res.headers.get("Vary")).toContain("Origin");
  });

  it("許可リストに無い Origin・Origin 無し・API 以外のパスには何も付けない", async () => {
    expect((await middleware(req("/api/events", { origin: "https://evil.example" }))).headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect((await middleware(req("/api/events"))).headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect((await middleware(req("/live", { origin: "https://localhost" }))).headers.get("Access-Control-Allow-Origin")).toBeNull();
    // 許可リストに無い Origin の OPTIONS は 204 にしない（従来どおり updateSession へ）
    const res = await middleware(req("/api/events", { method: "OPTIONS", origin: "https://evil.example" }));
    expect(res.status).not.toBe(204);
  });

  it("X-Sync-Key で守る同期ルートは updateSession を通さず素通し（CORS は Origin 次第で付く）", async () => {
    const res = await middleware(req("/api/platforms/whowatch/rankings/sync", { method: "POST", origin: "https://localhost" }));
    expect(updateSessionMock).not.toHaveBeenCalled();
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://localhost");
    const plain = await middleware(req("/api/platforms/whowatch/rankings/sync", { method: "POST" }));
    expect(plain.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("middleware の CSRF 対策（別サイトからの /api/* への書き込みは 403）", () => {
  beforeEach(() => {
    updateSessionMock.mockClear();
  });

  it("別サイトの Origin が付いた POST は、ログインの確認（Supabase）に行かず 403 の JSON", async () => {
    const res = await middleware(req("/api/platforms/whowatch/monitor", { method: "POST", origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(updateSessionMock).not.toHaveBeenCalled();
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("同期ルートも別サイトの Origin 付き POST は 403（GitHub Actions の curl は Origin を付けないので影響しない）", async () => {
    const res = await middleware(req("/api/platforms/whowatch/rankings/sync", { method: "POST", origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("自分のサイト・許可したアプリ・Origin 無しの POST はこれまでどおり通す", async () => {
    expect((await middleware(req("/api/events", { method: "POST", origin: "https://tagdeck.jp" }))).status).not.toBe(403);
    expect((await middleware(req("/api/events", { method: "POST", origin: "https://localhost" }))).status).not.toBe(403);
    expect((await middleware(req("/api/events", { method: "POST" }))).status).not.toBe(403);
    expect(updateSessionMock).toHaveBeenCalledTimes(3);
  });

  it("GET は Origin が別サイトでも 403 にしない（読み取りは各 API の認証に任せる）。API 以外のパスも対象外", async () => {
    expect((await middleware(req("/api/events", { origin: "https://evil.example" }))).status).not.toBe(403);
    expect((await middleware(req("/live", { method: "POST", origin: "https://evil.example" }))).status).not.toBe(403);
  });
});
