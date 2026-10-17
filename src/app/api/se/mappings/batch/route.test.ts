import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// まとめて保存・削除（2026-10-17）。DB は呼ばれた内容を記録するだけの偽物（検証したいのは入力の検査と畳み方）
type Row = { userId: string; key: string; url: string | null; volume: number; enabled: boolean; label: string | null; updatedAt: Date };
const h = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  inserted: [] as Row[],
  conflictTarget: null as unknown,
  deleteCalls: 0,
  deleteResult: [] as Array<{ key: string }>,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user }, error: null }) } }),
}));
vi.mock("@/lib/db/ensure-user", () => ({ ensureUserRow: async () => undefined }));
vi.mock("@/lib/db/client", () => ({
  createDbClient: () => ({
    insert: () => ({
      values: (rows: Row[]) => ({
        onConflictDoUpdate: (cfg: { target: unknown }) => ({
          returning: async () => {
            h.conflictTarget = cfg.target;
            h.inserted.push(...rows);
            return rows;
          },
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: async () => {
          h.deleteCalls++;
          return h.deleteResult;
        },
      }),
    }),
  }),
}));

import { DELETE, PUT } from "./route";

const URL_ = "https://tagdeck.jp/api/se/mappings/batch";
const call = (method: "PUT" | "DELETE", body: unknown) => (method === "PUT" ? PUT : DELETE)(new Request(URL_, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const SB = "https://abc.supabase.co/storage/v1/object/public/se/u1/item_1.mp3";

beforeEach(() => {
  h.user = { id: "u1" };
  h.inserted = [];
  h.conflictTarget = null;
  h.deleteCalls = 0;
  h.deleteResult = [];
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
});
afterEach(() => vi.unstubAllEnvs());

describe("PUT /api/se/mappings/batch", () => {
  it("未ログインは 401", async () => {
    h.user = null;
    expect((await call("PUT", { rows: [{ key: "item:1", url: SB }] })).status).toBe(401);
  });

  it("key の形・件数・url のホストを検査する（400）", async () => {
    expect((await call("PUT", { rows: [] })).status).toBe(400);
    expect((await call("PUT", { rows: [{ key: "nope:1", url: SB }] })).status).toBe(400);
    expect((await call("PUT", { rows: [{ key: "item:1" }] })).status).toBe(400);
    expect((await call("PUT", { rows: [{ key: "item:1", url: "https://evil.example/x.mp3" }] })).status).toBe(400);
    expect((await call("PUT", { rows: Array.from({ length: 501 }, (_, i) => ({ key: `item:${i}`, url: SB })) })).status).toBe(400);
    expect(h.inserted).toEqual([]);
  });

  it("自分の行として upsert し、同じ key は後の行で畳む。既定は volume 80・enabled true", async () => {
    const res = await call("PUT", {
      rows: [
        { key: "item:1", url: SB, label: "a.mp3" },
        { key: "item:1#2", url: SB, label: "b.mp3", volume: 50, enabled: false },
        { key: "pattern:9", url: SB },
        { key: "item:1", url: `${SB}?v=2`, label: "c.mp3" },
      ],
    });
    expect(res.status).toBe(200);
    expect(h.inserted.map((r) => [r.userId, r.key, r.url, r.volume, r.enabled, r.label])).toEqual([
      ["u1", "item:1", `${SB}?v=2`, 80, true, "c.mp3"],
      ["u1", "item:1#2", SB, 50, false, "b.mp3"],
      ["u1", "pattern:9", SB, 80, true, null],
    ]);
    expect(Array.isArray(h.conflictTarget)).toBe(true);
    const body = (await res.json()) as { mappings: Array<{ key: string; updatedAt: string }> };
    expect(body.mappings.map((m) => m.key)).toEqual(["item:1", "item:1#2", "pattern:9"]);
    expect(typeof body.mappings[0].updatedAt).toBe("string");
  });
});

describe("DELETE /api/se/mappings/batch", () => {
  it("未ログインは 401、keys の形は検査する", async () => {
    h.user = null;
    expect((await call("DELETE", { keys: ["item:1"] })).status).toBe(401);
    h.user = { id: "u1" };
    expect((await call("DELETE", { keys: [] })).status).toBe(400);
    expect((await call("DELETE", { keys: ["x"] })).status).toBe(400);
    expect(h.deleteCalls).toBe(0);
  });

  it("消した件数を返す", async () => {
    h.deleteResult = [{ key: "item:1" }, { key: "item:1#2" }];
    const res = await call("DELETE", { keys: ["item:1", "item:1#2", "item:1"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 2 });
    expect(h.deleteCalls).toBe(1);
  });
});
