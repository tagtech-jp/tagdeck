import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SYNC_ROUTES, isSyncRoutePath } from "./sync-routes";

// 全同期ルート共通の軽量フェイク DB。rankings/sync の db.select().from().where() のみ実際に使われる
// （events/sync・items/sync は同期処理そのものを下のモックで差し替えるため db の中身は参照されない）。
function makeFakeDb() {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.from = () => chain;
  chain.where = () => Promise.resolve([]);
  return chain;
}
vi.mock("@/lib/db/client", () => ({ createDbClient: () => makeFakeDb() }));
vi.mock("@/lib/whowatch/ranking-sync", () => ({ syncSimulatorRanking: vi.fn() }));
vi.mock("@/lib/whowatch/event-detail-sync", () => ({
  syncAllEventDetails: vi.fn(async () => ({ at: new Date().toISOString(), targets: 0, processed: 0, succeeded: 0, failed: 0, next_cursor: null, results: [] })),
}));
vi.mock("@/lib/whowatch/item-patterns-sync", () => ({
  syncItemPatterns: vi.fn(async () => ({ items: 0, patterns: 0, hits: 0, chunks: 0 })),
}));
vi.mock("@/lib/notify-gw", () => ({ sendNotifyGw: vi.fn(async () => ({ sent: false })) }));

const KEY = "test-sync-key-0123456789";

// SYNC_ROUTES のパス → ルートモジュールの importer。新しい同期ルートを SYNC_ROUTES に足したら、
// ここにも importer を足す必要がある（下の「登録漏れ検知」テストが、片方だけの追記を検知する）。
const ROUTE_IMPORTERS: Record<string, () => Promise<{ POST: (req: Request) => Promise<Response> }>> = {
  "/api/platforms/whowatch/rankings/sync": () => import("@/app/api/platforms/whowatch/rankings/sync/route"),
  "/api/platforms/whowatch/events/sync": () => import("@/app/api/platforms/whowatch/events/sync/route"),
  "/api/platforms/whowatch/items/sync": () => import("@/app/api/platforms/whowatch/items/sync/route"),
};

describe("SYNC_ROUTES 登録漏れ検知", () => {
  it("SYNC_ROUTES の全パスに ROUTE_IMPORTERS のエントリがある", () => {
    for (const r of SYNC_ROUTES) {
      expect(ROUTE_IMPORTERS[r.path], `${r.path} の importer がテストに未登録`).toBeDefined();
    }
  });
  it("ROUTE_IMPORTERS の全パスが SYNC_ROUTES に登録されている（逆方向）", () => {
    const known = new Set<string>(SYNC_ROUTES.map((r) => r.path));
    for (const path of Object.keys(ROUTE_IMPORTERS)) {
      expect(known.has(path), `${path} は ROUTE_IMPORTERS にあるが SYNC_ROUTES に無い`).toBe(true);
    }
  });
});

describe("middleware: SYNC_ROUTES は必ず素通しされる（本番 307 の再発防止）", () => {
  it("isSyncRoutePath は登録済みパスで true、それ以外で false", () => {
    for (const r of SYNC_ROUTES) expect(isSyncRoutePath(r.path)).toBe(true);
    const nonSyncPaths: string[] = ["/dashboard", "/api/events", "/login"];
    for (const p of nonSyncPaths) expect(isSyncRoutePath(p)).toBe(false);
  });

  it.each(SYNC_ROUTES)("middleware($path) は未認証でもリダイレクトしない", async (route) => {
    const { middleware } = await import("@/middleware");
    const req = new NextRequest(new Request(`https://tagdeck.jp${route.path}`, { method: "POST" }));
    const res = await middleware(req);
    expect(res.status).not.toBe(307);
    expect(res.status).not.toBe(308);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe.each(SYNC_ROUTES)("同期ルート認証ループ: $path", (route) => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env[route.envKey];
    process.env[route.envKey] = KEY;
  });
  afterEach(() => {
    if (original === undefined) delete process.env[route.envKey];
    else process.env[route.envKey] = original;
  });

  it("未認証(Cookie 無し) + 正しいキー → 200", async () => {
    const { POST } = await ROUTE_IMPORTERS[route.path]();
    const res = await POST(new Request(`https://tagdeck.jp${route.path}`, { method: "POST", headers: { "X-Sync-Key": KEY } }));
    expect(res.status).toBe(200);
  });

  it("キー無し → 401（リダイレクトしない）", async () => {
    const { POST } = await ROUTE_IMPORTERS[route.path]();
    const res = await POST(new Request(`https://tagdeck.jp${route.path}`, { method: "POST" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
  });

  it("キー不一致 → 401", async () => {
    const { POST } = await ROUTE_IMPORTERS[route.path]();
    const res = await POST(new Request(`https://tagdeck.jp${route.path}`, { method: "POST", headers: { "X-Sync-Key": "wrong-key-xxxxxxxxxxxxxxx" } }));
    expect(res.status).toBe(401);
  });
});
