import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  returned: [] as Array<{ id: string }>,
  setValues: null as Record<string, unknown> | null,
  whereCond: null as unknown,
  deleteCalls: 0,
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }) }));
vi.mock("@/lib/db/client", () => ({
  createDbClient: () => ({
    update: () => ({
      set: (v: Record<string, unknown>) => {
        h.setValues = v;
        return {
          where: (c: unknown) => {
            h.whereCond = c;
            return { returning: async () => h.returned };
          },
        };
      },
    }),
    delete: () => {
      h.deleteCalls++;
      throw new Error("物理削除は使わない（ranking_snapshots が CASCADE で消えるため）");
    },
  }),
}));

import { DELETE } from "./route";

const call = (id = "sim-1") =>
  DELETE(new Request(`https://tagdeck.jp/api/events/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });

describe("DELETE /api/events/[id]（論理削除）", () => {
  beforeEach(() => {
    h.user = { id: "user-1" };
    h.returned = [{ id: "sim-1" }];
    h.setValues = null;
    h.whereCond = null;
    h.deleteCalls = 0;
  });

  it("行は消さず status を deleted にする（ランキング履歴を残す）", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(h.deleteCalls).toBe(0);
    expect(h.setValues).toMatchObject({ status: "deleted" });
    expect(h.setValues?.updatedAt).toBeInstanceOf(Date);
  });

  it("本人の・削除済みでないシミュレーターだけを対象にする", async () => {
    await call();
    const q = new PgDialect().sqlToQuery(h.whereCond as SQL);
    expect(q.params).toEqual(["sim-1", "user-1", "deleted"]);
    expect(q.sql).toContain('"event_simulators"."status" <> $3');
  });

  it("該当なし（他人のもの・削除済み）→ 404", async () => {
    h.returned = [];
    expect((await call()).status).toBe(404);
  });

  it("未ログイン → 401 で DB に触れない", async () => {
    h.user = null;
    expect((await call()).status).toBe(401);
    expect(h.setValues).toBeNull();
  });
});
