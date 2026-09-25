import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// DB と同期処理はモック（未認証＝Cookie 無しの呼び出しでもハンドラが動くことを検証する）
const selectMock = vi.fn();
vi.mock("@/lib/db/client", () => ({
  createDbClient: () => ({
    select: () => ({ from: () => ({ where: selectMock }) }),
  }),
}));
const syncMock = vi.fn();
vi.mock("@/lib/whowatch/ranking-sync", () => ({
  syncSimulatorRanking: (...args: unknown[]) => syncMock(...args),
}));

import { POST } from "./route";
import { verifySyncKey } from "@/lib/whowatch/sync-auth";

const URL_ = "https://tagdeck.jp/api/platforms/whowatch/rankings/sync";
const KEY = "test-sync-key-0123456789";

function req(headers: Record<string, string> = {}): Request {
  // Cookie 無し = 未認証の呼び出し
  return new Request(URL_, { method: "POST", headers });
}

describe("POST /api/platforms/whowatch/rankings/sync", () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env.RANKING_SYNC_KEY;
    process.env.RANKING_SYNC_KEY = KEY;
    selectMock.mockReset();
    syncMock.mockReset();
  });
  afterEach(() => {
    if (original === undefined) delete process.env.RANKING_SYNC_KEY;
    else process.env.RANKING_SYNC_KEY = original;
  });

  it("未認証 + 正しいキー → 200 で処理件数を返す（スナップショット保存まで到達）", async () => {
    selectMock.mockResolvedValue([
      { id: "sim-1", rankingType: "autumncollection_1st_overall", userId: "u1" },
      { id: "sim-2", rankingType: "psr_gold_plus_a", userId: "u2" },
    ]);
    syncMock
      .mockResolvedValueOnce({ myEntry: { rank: 6 }, snapshotId: "snap-1" })
      .mockRejectedValueOnce(new Error("HTTP 500"));

    const res = await POST(req({ "X-Sync-Key": KEY }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; targets: number; results: Array<{ ok: boolean; snapshotId: string | null; error?: string }> };
    expect(body.ok).toBe(true);
    expect(body.targets).toBe(2);
    expect(body.results[0]).toMatchObject({ ok: true, snapshotId: "snap-1" });
    expect(body.results[1]).toMatchObject({ ok: false, error: "HTTP 500" });
    expect(syncMock).toHaveBeenCalledTimes(2);
  });

  it("キー無し → 401 JSON（リダイレクトしない）", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.json()).toEqual({ error: "missing X-Sync-Key" });
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("キー不一致 → 401 JSON", async () => {
    const res = await POST(req({ "X-Sync-Key": "wrong-key-xxxxxxxxxxxxxxx" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid X-Sync-Key" });
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("RANKING_SYNC_KEY 未設定 → 401 JSON", async () => {
    delete process.env.RANKING_SYNC_KEY;
    const res = await POST(req({ "X-Sync-Key": KEY }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "RANKING_SYNC_KEY not configured" });
  });

  it("?dry=1 → 認証・対象抽出は行うが同期・書き込みはしない", async () => {
    selectMock.mockResolvedValue([
      { id: "sim-1", rankingType: "autumncollection_1st_overall", userId: "u1" },
      { id: "sim-2", rankingType: "psr_gold_plus_a", userId: "u2" },
    ]);
    const res = await POST(new Request(`${URL_}?dry=1`, { method: "POST", headers: { "X-Sync-Key": KEY } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, dryRun: true, targets: 2 });
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("?dry=1 でも未認証なら401(疎通確認用でも鍵検証はスキップしない)", async () => {
    const res = await POST(new Request(`${URL_}?dry=1`, { method: "POST" }));
    expect(res.status).toBe(401);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("verifySyncKey は長さ違い・部分一致を拒否する", () => {
    expect(verifySyncKey(KEY, KEY)).toEqual({ ok: true });
    expect(verifySyncKey(KEY.slice(0, -1), KEY).ok).toBe(false);
    expect(verifySyncKey(KEY + "x", KEY).ok).toBe(false);
    expect(verifySyncKey("", KEY).ok).toBe(false);
  });
});
