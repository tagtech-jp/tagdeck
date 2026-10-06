import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SYNC_ROUTES, isSyncRoutePath } from "./sync-routes";

// 全同期ルート共通の軽量フェイク DB。rankings/sync の db.select().from().where() のみ実際に使われる
// （events/sync・items/sync は同期処理そのものを下のモックで差し替えるため db の中身は参照されない）。
function makeFakeDb() {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.from = () => chain;
  chain.where = () => Promise.resolve([]);
  // items/export は where 無しの select().from() を await するので、チェーン自体も空配列に解決させる
  chain.then = (resolve: (v: unknown[]) => void) => resolve([]);
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
// items/sync が初回バッチ（cursor 無し）で呼ぶ下位同期。差し替えないとふわっちの本物の API
// （/playitems/payments3・/lives/{id}/playitems3 等）へ通信し、フェイク DB に insert が無いため失敗ログも出る（2026-10-07）
vi.mock("@/lib/whowatch/item-groups-sync", () => ({
  fetchPaymentCategories: vi.fn(async () => []),
  syncItemGroups: vi.fn(async () => ({ categories: 0, rows: 0, inserted: 0, updated: 0, deleted: 0 })),
}));
vi.mock("@/lib/whowatch/item-prices", () => ({ syncItemPrices: vi.fn(async () => ({ rows: 0, inserted: 0, updated: 0, fromPacks: 0 })) }));
vi.mock("@/lib/whowatch/free-event-items", () => ({
  syncFreeEventItems: vi.fn(async () => ({ eventsResolved: 0, eventsFetched: 0, rows: 0, inserted: 0, updated: 0, deleted: 0 })),
}));
vi.mock("@/lib/whowatch/item-decorations", () => ({ syncItemDecorations: vi.fn(async () => ({ liveId: null, rows: 0, withGrades: 0, inserted: 0, updated: 0 })) }));
vi.mock("@/lib/whowatch/pack-prices", () => ({ resolvePackItems: vi.fn(async () => ({ packs: 0, items: [], unresolved: [] })) }));
vi.mock("@/lib/notify-gw", () => ({ sendNotifyGw: vi.fn(async () => ({ sent: false })) }));

// 番人: モック漏れで外部へ通信したら、テストを失敗させて気づけるようにする（各ルートは通信失敗を握りつぶして 200 を返し得るため）
const fetchSpy = vi.fn(async (input: unknown) => {
  throw new Error(`sync-routes.test: 外部通信は禁止（モック漏れ）: ${String(input)}`);
});
beforeAll(() => {
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  // 先に記録を消してから判定する（判定で失敗しても、後続テストへ呼び出し記録を持ち越さない）
  const calls = fetchSpy.mock.calls.map(([input]) => String(input));
  fetchSpy.mockClear();
  expect(calls, "テスト中に fetch が呼ばれた（下位同期のモック漏れ）").toEqual([]);
});

const KEY = "test-sync-key-0123456789";
// ルートと middleware の初回読み込みは全体実行時に数秒かかる。テスト本体（既定 5 秒枠）の中で読むと時間切れになるため、
// beforeAll で先に読み込んでおく（2026-10-06・simulators/export/route.test.ts と同じ原因）
const PRELOAD_TIMEOUT_MS = 30_000;

// SYNC_ROUTES のパス → ルートモジュールの importer。新しい同期ルートを SYNC_ROUTES に足したら、
// ここにも importer を足す必要がある（下の「登録漏れ検知」テストが、片方だけの追記を検知する）。
const ROUTE_IMPORTERS: Record<string, () => Promise<{ POST: (req: Request) => Promise<Response> }>> = {
  "/api/platforms/whowatch/rankings/sync": () => import("@/app/api/platforms/whowatch/rankings/sync/route"),
  "/api/platforms/whowatch/events/sync": () => import("@/app/api/platforms/whowatch/events/sync/route"),
  "/api/platforms/whowatch/items/sync": () => import("@/app/api/platforms/whowatch/items/sync/route"),
  "/api/platforms/whowatch/items/export": () => import("@/app/api/platforms/whowatch/items/export/route"),
  "/api/platforms/whowatch/simulators/export": () => import("@/app/api/platforms/whowatch/simulators/export/route"),
  "/api/platforms/whowatch/items/learned": () => import("@/app/api/platforms/whowatch/items/learned/route"),
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
  beforeAll(async () => {
    await import("@/middleware");
  }, PRELOAD_TIMEOUT_MS);

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
  beforeAll(async () => {
    await ROUTE_IMPORTERS[route.path]();
  }, PRELOAD_TIMEOUT_MS);

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
