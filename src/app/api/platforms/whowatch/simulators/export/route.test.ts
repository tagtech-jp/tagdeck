import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 問い合わせ(select().from().where()[.orderBy().limit()])を await した順に、用意した結果を返すフェイク DB。
// 結果に Error を入れると、その問い合わせは失敗する
const results: unknown[] = [];
const whereArgs: unknown[] = [];
function makeFakeDb() {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.from = () => chain;
  chain.where = (arg: unknown) => {
    whereArgs.push(arg);
    let value: Promise<unknown> | null = null;
    const run = () => {
      if (!value) {
        const next = results.shift();
        value = next instanceof Error ? Promise.reject(next) : Promise.resolve(next ?? []);
      }
      return value;
    };
    const q: Record<string, unknown> = {};
    q.orderBy = () => q;
    q.limit = () => q;
    q.then = (ok: (v: unknown) => unknown, ng?: (e: unknown) => unknown) => run().then(ok, ng);
    return q;
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
  updatedAt: new Date("2026-10-02T09:00:00Z"), rankingType: null as string | null,
};

// ランキングの記録(5 分ごと)。自分は 4 位、目標は 3 位。ライバルの名前が出力に漏れないかを確かめる
function snapshot(minutesAgo: number, myPoint: number) {
  const capturedAt = new Date(Date.now() - minutesAgo * 60_000);
  const bump = (base: number) => base + (60 - minutesAgo) * 10;
  return {
    capturedAt, myRank: 4, myPoint,
    entries: [
      { rank: 1, point: bump(30000), user_id: "r1", user_path: "w:r1", name: "ライバルA", total_view_count: null },
      { rank: 2, point: bump(25000), user_id: "r2", user_path: "w:r2", name: "ライバルB", total_view_count: null },
      { rank: 3, point: bump(20000), user_id: "r3", user_path: "w:r3", name: "ライバルC", total_view_count: null },
      { rank: 4, point: myPoint, user_id: "me", user_path: "t:me", name: "自分", total_view_count: null },
    ],
  };
}

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
      ranking_type: null, forecast: null, forecast_error: null, score_history: [],
    }]);
    expect(JSON.stringify(body)).not.toMatch(/rival/i);
  });

  it("ランキング型で目標順位があれば、画面と同じ手順の予測と自分の点数の推移を返す(ライバルの名前は出さない)", async () => {
    process.env.EXPORT_OWNER_USER_ID = "00000000-0000-0000-0000-000000000001";
    const sim = { ...row, rankingType: "magicfantasy_1st_doll_gold", targetRank: 3, startTime: new Date(Date.now() - 2 * 86_400_000), endTime: new Date(Date.now() + 3 * 86_400_000) };
    const latest = [snapshot(0, 18_600), snapshot(5, 18_550), snapshot(10, 18_500)]; // 新しい順(orderBy desc)
    const history = [snapshot(10, 18_500), snapshot(5, 18_550), snapshot(0, 18_600)].map((s) => ({ capturedAt: s.capturedAt, myPoint: s.myPoint }));
    results.push([sim], [{ id: 1523, eventKey: "2026_10_magicfantasy" }], latest, history);
    const { GET } = await import("./route");
    const body = (await (await GET(new Request(URL, { headers: { "X-Sync-Key": KEY } }))).json()) as ExportBody;
    const s = body.simulators[0] as { forecast: Record<string, unknown>; score_history: Array<{ score: number }>; ranking_type: string };
    expect(s.ranking_type).toBe("magicfantasy_1st_doll_gold");
    expect(s.forecast).toMatchObject({ target_rank: 3, current_rank: 4, current_point: 18_600, snapshot_count: 3 });
    const req = s.forecast.required_points as { p50: number; p90: number };
    expect(req.p50).toBeGreaterThan(0); // 3 位(20,000 pt 台)に入るには追加が要る
    expect(req.p90).toBeGreaterThanOrEqual(req.p50);
    expect(s.score_history.map((h) => h.score)).toEqual([18_500, 18_550, 18_600]);
    const json = JSON.stringify(body);
    expect(json).not.toMatch(/ライバル[ABC]/); // ライバルの名前は返さない
    expect(json).not.toMatch(/"rivals"/);
  });

  it("予測の計算に失敗しても、目標そのものは返す", async () => {
    process.env.EXPORT_OWNER_USER_ID = "00000000-0000-0000-0000-000000000001";
    const sim = { ...row, rankingType: "magicfantasy_1st_doll_gold", targetRank: 3, endTime: new Date(Date.now() + 86_400_000) };
    results.push([sim], [{ id: 1523, eventKey: "2026_10_magicfantasy" }], new Error("ranking_snapshots timeout"));
    const { GET } = await import("./route");
    const res = await GET(new Request(URL, { headers: { "X-Sync-Key": KEY } }));
    expect(res.status).toBe(200);
    const s = ((await res.json()) as ExportBody).simulators[0];
    expect(s).toMatchObject({ id: "s1", target_rank: 3, forecast: null, score_history: [] });
    expect(String(s.forecast_error)).toMatch(/timeout/);
  });

  it("終わって 7 日を過ぎたシミュレーターには予測を付けない(ランキングの記録を読まない)", async () => {
    process.env.EXPORT_OWNER_USER_ID = "00000000-0000-0000-0000-000000000001";
    const old = { ...row, rankingType: "x", targetRank: 3, endTime: new Date(Date.now() - 8 * 86_400_000) };
    results.push([old], [{ id: 1523, eventKey: "k" }]);
    const { GET } = await import("./route");
    const s = ((await (await GET(new Request(URL, { headers: { "X-Sync-Key": KEY } }))).json()) as ExportBody).simulators[0];
    expect(s.forecast).toBeNull();
    expect(whereArgs).toHaveLength(2); // シミュレーターと event_key だけ
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
