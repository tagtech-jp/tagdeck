import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// select().from().where() の呼び出しごとに、用意した結果を順に返すフェイク DB
const results: unknown[][] = [];
const whereArgs: unknown[] = [];
function makeFakeDb() {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.from = () => chain;
  chain.where = (arg: unknown) => {
    whereArgs.push(arg);
    return Promise.resolve(results.shift() ?? []);
  };
  return chain;
}
vi.mock("@/lib/db/client", () => ({ createDbClient: () => makeFakeDb() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

type ExportBody = { configured: boolean; count: number; simulators: Record<string, unknown>[] };
const KEY = "test-sync-key-0123456789";
const URL = "https://tagdeck.jp/api/platforms/whowatch/simulators/export";

const row = {
  id: "s1", name: "マジックファンタジー", platform: "whowatch", eventType: "ranking",
  targetScore: 30000, targetRank: 10, whowatchEventId: 1523,
  startTime: new Date("2026-09-30T15:00:00Z"), endTime: new Date("2026-10-12T14:59:00Z"),
  status: "active", currentScore: 1200, currentRank: 35, manualScore: null,
  updatedAt: new Date("2026-10-02T09:00:00Z"),
};

describe("simulators/export", () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = { k: process.env.RANKING_SYNC_KEY, o: process.env.EXPORT_OWNER_USER_ID };
    process.env.RANKING_SYNC_KEY = KEY;
    results.length = 0;
    whereArgs.length = 0;
  });
  afterEach(() => {
    for (const [name, v] of [["RANKING_SYNC_KEY", saved.k], ["EXPORT_OWNER_USER_ID", saved.o]] as const) {
      if (v === undefined) delete process.env[name];
      else process.env[name] = v;
    }
  });

  it("運営者が未設定なら DB を読まずに configured=false の空配列", async () => {
    delete process.env.EXPORT_OWNER_USER_ID;
    const { GET } = await import("./route");
    const res = await GET(new Request(URL, { headers: { "X-Sync-Key": KEY } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ExportBody;
    expect(body).toMatchObject({ configured: false, count: 0, simulators: [] });
    expect(whereArgs).toHaveLength(0);
  });

  it("運営者の目標・進捗と event_key を返し、ライバルは含めない", async () => {
    process.env.EXPORT_OWNER_USER_ID = "00000000-0000-0000-0000-000000000001";
    results.push([row], [{ id: 1523, eventKey: "2026_10_magicfantasy" }]);
    const { GET } = await import("./route");
    const res = await GET(new Request(URL, { headers: { "X-Sync-Key": KEY } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = (await res.json()) as ExportBody;
    expect(body.configured).toBe(true);
    expect(body.simulators).toEqual([{
      id: "s1", name: "マジックファンタジー", platform: "whowatch", event_type: "ranking",
      event_key: "2026_10_magicfantasy", whowatch_event_id: 1523,
      start_time: "2026-09-30T15:00:00.000Z", end_time: "2026-10-12T14:59:00.000Z", status: "active",
      target_score: 30000, target_rank: 10, current_score: 1200, current_score_source: "auto", current_rank: 35,
      updated_at: "2026-10-02T09:00:00.000Z",
    }]);
    expect(JSON.stringify(body)).not.toMatch(/rival/i);
  });

  it("手入力のスコアがあればそちらを現在値にする", async () => {
    process.env.EXPORT_OWNER_USER_ID = "00000000-0000-0000-0000-000000000001";
    results.push([{ ...row, whowatchEventId: null, manualScore: 5000 }]);
    const { GET } = await import("./route");
    const body = (await (await GET(new Request(URL, { headers: { "X-Sync-Key": KEY } }))).json()) as ExportBody;
    expect(body.simulators[0]).toMatchObject({ current_score: 5000, current_score_source: "manual", event_key: null });
  });

  it("利用者をリクエストで指定できない（クエリは無視して運営者の分だけ）", async () => {
    process.env.EXPORT_OWNER_USER_ID = "00000000-0000-0000-0000-000000000001";
    results.push([]);
    const { GET } = await import("./route");
    const res = await GET(new Request(`${URL}?user_id=someone-else`, { headers: { "X-Sync-Key": KEY } }));
    expect(res.status).toBe(200);
    expect(whereArgs).toHaveLength(1); // 運営者の分を1回だけ検索している（route.ts はクエリを読まない）
    expect(((await res.json()) as ExportBody).simulators).toEqual([]);
  });

  it("キー不一致 → 401", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request(URL, { headers: { "X-Sync-Key": "wrong-key-xxxxxxxxxxxxxxx" } }));
    expect(res.status).toBe(401);
  });
});
