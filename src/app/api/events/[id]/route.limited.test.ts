import { beforeEach, describe, expect, it, vi } from "vitest";

// PATCH（設定編集）が期間限定アイテム型のハイフン入り ranking_type を受け付け、null で自動判定に戻せること（2026-10-07）
const h = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  returned: [] as Array<Record<string, unknown>>,
  setValues: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }) }));
vi.mock("@/lib/db/client", () => ({
  createDbClient: () => ({
    update: () => ({
      set: (v: Record<string, unknown>) => {
        h.setValues = v;
        return { where: () => ({ returning: async () => h.returned }) };
      },
    }),
  }),
}));

import { PATCH } from "./route";

const call = (body: unknown, id = "sim-1") =>
  PATCH(new Request(`https://tagdeck.jp/api/events/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });

describe("PATCH /api/events/[id]（期間限定アイテム型の区分）", () => {
  beforeEach(() => {
    h.user = { id: "user-1" };
    h.returned = [{ id: "sim-1" }];
    h.setValues = null;
  });

  it("limited-item-{event_key}-{group}（ハイフン入り）を受け付ける", async () => {
    const res = await call({ rankingType: "limited-item-2026_10_gold_digger_1-2" });
    expect(res.status).toBe(200);
    expect(h.setValues?.rankingType).toBe("limited-item-2026_10_gold_digger_1-2");
  });

  it("null で区分を空に戻せる（自動判定に戻す）", async () => {
    const res = await call({ rankingType: null });
    expect(res.status).toBe(200);
    expect(h.setValues?.rankingType).toBeNull();
  });

  it("記号を含む値は 400", async () => {
    const res = await call({ rankingType: "bad type!" });
    expect(res.status).toBe(400);
    expect(h.setValues).toBeNull();
  });
});
