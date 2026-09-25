import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ createDbClient: () => ({}) }));
const syncAllMock = vi.fn<(db: unknown, opts: unknown) => Promise<unknown>>();
vi.mock("@/lib/whowatch/event-detail-sync", () => ({ syncAllEventDetails: (db: unknown, opts: unknown) => syncAllMock(db, opts) }));
const notifyMock = vi.fn<(ev: Record<string, unknown>) => Promise<{ sent: boolean }>>(async () => ({ sent: true }));
vi.mock("@/lib/notify-gw", () => ({ sendNotifyGw: (ev: Record<string, unknown>) => notifyMock(ev) }));

import { POST } from "./route";

const URL_ = "https://tagdeck.jp/api/platforms/whowatch/events/sync";
const KEY = "test-sync-key-0123456789";

describe("POST /api/platforms/whowatch/events/sync", () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env.RANKING_SYNC_KEY;
    process.env.RANKING_SYNC_KEY = KEY;
    syncAllMock.mockReset();
    notifyMock.mockClear();
  });
  afterEach(() => {
    if (original === undefined) delete process.env.RANKING_SYNC_KEY;
    else process.env.RANKING_SYNC_KEY = original;
  });

  it("正しいキー → 200、全件成功なら通知しない", async () => {
    syncAllMock.mockResolvedValue({ at: "2026-09-21T00:00:00Z", targets: 2, processed: 2, succeeded: 2, failed: 0, next_cursor: null, results: [] });
    const res = await POST(new Request(URL_, { method: "POST", headers: { "X-Sync-Key": KEY } }));
    expect(res.status).toBe(200);
    expect((await res.json()).targets).toBe(2);
    expect(syncAllMock).toHaveBeenCalledWith({}, { force: false, limit: undefined, cursor: null, eventKey: null });
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("?force=1 で取り直し、失敗があれば notify-gw に WARN", async () => {
    syncAllMock.mockResolvedValue({ at: "2026-09-21T00:00:00Z", targets: 2, processed: 2, succeeded: 1, failed: 1, next_cursor: null, results: [{ eventKey: "x", ok: false, stage: "struct", error: "HTTP 502" }] });
    const res = await POST(new Request(URL_ + "?force=1", { method: "POST", headers: { "X-Sync-Key": KEY } }));
    expect(res.status).toBe(200);
    expect(syncAllMock).toHaveBeenCalledWith({}, { force: true, limit: undefined, cursor: null, eventKey: null });
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][0]).toMatchObject({ severity: "WARN", action: "whowatch_event_detail_sync" });
  });

  it("?cursor / ?limit / ?event_key を渡す。不正な event_key は 400", async () => {
    syncAllMock.mockResolvedValue({ at: "2026-09-21T00:00:00Z", targets: 14, processed: 3, succeeded: 3, failed: 0, next_cursor: "2026_09_gingiragin", results: [] });
    const res = await POST(new Request(URL_ + "?cursor=2026_09_autumncollectionlite&limit=3", { method: "POST", headers: { "X-Sync-Key": KEY } }));
    expect(res.status).toBe(200);
    expect((await res.json()).next_cursor).toBe("2026_09_gingiragin");
    expect(syncAllMock).toHaveBeenLastCalledWith({}, { force: false, limit: 3, cursor: "2026_09_autumncollectionlite", eventKey: null });

    await POST(new Request(URL_ + "?event_key=2026_09_autumncollection&force=1", { method: "POST", headers: { "X-Sync-Key": KEY } }));
    expect(syncAllMock).toHaveBeenLastCalledWith({}, { force: true, limit: undefined, cursor: null, eventKey: "2026_09_autumncollection" });

    const bad = await POST(new Request(URL_ + "?event_key=../x", { method: "POST", headers: { "X-Sync-Key": KEY } }));
    expect(bad.status).toBe(400);
  });

  it("キー無し／不一致 → 401 JSON", async () => {
    expect((await POST(new Request(URL_, { method: "POST" }))).status).toBe(401);
    expect((await POST(new Request(URL_, { method: "POST", headers: { "X-Sync-Key": "wrong-key-xxxxxxxxxxxxxxx" } }))).status).toBe(401);
    expect(syncAllMock).not.toHaveBeenCalled();
  });
});
