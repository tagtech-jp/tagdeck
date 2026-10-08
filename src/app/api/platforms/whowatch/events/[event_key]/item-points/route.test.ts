import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

// 全利用者共有の基礎 pt（event_item_points）は運営者（EXPORT_OWNER_USER_ID）だけが書ける（2026-10-08 セキュリティ監査 §3-4・社長決定 案 A）。
// 運営者以外の PUT / DELETE は 403（code: OWNER_ONLY）で DB に触れない。GET は誰でも読め、canEdit で画面が「保存」を出すかを決める。
// EXPORT_OWNER_USER_ID が未設定・空文字なら誰も運営者ではない（空文字で全員一致にならないこと）。

const OWNER = "00000000-0000-0000-0000-000000000001";
const OTHER = "00000000-0000-0000-0000-000000000002";
const EVENT_KEY = "2026_10_magicfantasy";

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  rows: [] as Array<{ itemId: string; basePoint: number; source: string; updatedAt: Date }>,
  /** createDbClient が呼ばれた回数。403 / 401 / 400 では 0 のまま（DB に触れない） */
  dbCalls: 0,
  inserted: null as Record<string, unknown> | null,
  upsertTarget: null as unknown,
  deleteWhere: null as unknown,
  deleted: [] as Array<{ id: string }>,
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }) }));
vi.mock("@/lib/db/client", () => ({
  createDbClient: () => {
    h.dbCalls++;
    return {
      select: () => ({ from: () => ({ where: async () => h.rows }) }),
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          h.inserted = v;
          return {
            onConflictDoUpdate: (c: { target: unknown }) => {
              h.upsertTarget = c.target;
              return { returning: async () => [{ id: "row-1", ...v }] };
            },
          };
        },
      }),
      delete: () => ({
        where: (c: unknown) => {
          h.deleteWhere = c;
          return { returning: async () => h.deleted };
        },
      }),
    };
  },
}));

import { DELETE, GET, PUT } from "./route";

const URL_BASE = `https://tagdeck.jp/api/platforms/whowatch/events/${EVENT_KEY}/item-points`;
const ctx = { params: Promise.resolve({ event_key: EVENT_KEY }) };
const get = () => GET(new Request(URL_BASE), ctx);
const put = (body: unknown = { itemId: "10770", basePoint: 120 }) =>
  PUT(new Request(URL_BASE, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ctx);
const del = (itemId = "10770") => DELETE(new Request(`${URL_BASE}?itemId=${itemId}`, { method: "DELETE" }), ctx);
const canEditOf = async (res: Response) => ((await res.json()) as { canEdit: boolean }).canEdit;

describe("/api/platforms/whowatch/events/[event_key]/item-points（全利用者共有の基礎 pt）", () => {
  let savedOwner: string | undefined;
  beforeEach(() => {
    savedOwner = process.env.EXPORT_OWNER_USER_ID;
    process.env.EXPORT_OWNER_USER_ID = OWNER;
    h.user = { id: OTHER };
    h.rows = [{ itemId: "10770", basePoint: 120, source: "manual", updatedAt: new Date("2026-10-08T10:00:00Z") }];
    h.dbCalls = 0;
    h.inserted = null;
    h.upsertTarget = null;
    h.deleteWhere = null;
    h.deleted = [{ id: "row-1" }];
  });
  afterEach(() => {
    if (savedOwner === undefined) delete process.env.EXPORT_OWNER_USER_ID;
    else process.env.EXPORT_OWNER_USER_ID = savedOwner;
  });

  describe("GET", () => {
    it("運営者以外も読める。canEdit は false", async () => {
      const res = await get();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        eventKey: EVENT_KEY,
        canEdit: false,
        items: [{ itemId: "10770", basePoint: 120, source: "manual", updatedAt: "2026-10-08T10:00:00.000Z" }],
      });
    });

    it("運営者は canEdit が true", async () => {
      h.user = { id: OWNER };
      expect(await canEditOf(await get())).toBe(true);
    });

    it("EXPORT_OWNER_USER_ID が未設定・空文字なら運営者の id でも canEdit は false", async () => {
      h.user = { id: OWNER };
      delete process.env.EXPORT_OWNER_USER_ID;
      expect(await canEditOf(await get())).toBe(false);
      process.env.EXPORT_OWNER_USER_ID = "";
      expect(await canEditOf(await get())).toBe(false);
    });

    it("未ログイン → 401 で DB に触れない", async () => {
      h.user = null;
      expect((await get()).status).toBe(401);
      expect(h.dbCalls).toBe(0);
    });
  });

  describe("PUT", () => {
    it("運営者以外 → 403（code: OWNER_ONLY）で DB に触れない", async () => {
      const res = await put();
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "OWNER_ONLY" });
      expect(h.dbCalls).toBe(0);
      expect(h.inserted).toBeNull();
    });

    it("EXPORT_OWNER_USER_ID が未設定・空文字なら運営者の id でも 403（誰も書けない）", async () => {
      h.user = { id: OWNER };
      delete process.env.EXPORT_OWNER_USER_ID;
      expect((await put()).status).toBe(403);
      process.env.EXPORT_OWNER_USER_ID = "";
      expect((await put()).status).toBe(403);
      expect(h.dbCalls).toBe(0);
    });

    it("運営者 → (event_key, item_id) で upsert し、保存した行を返す", async () => {
      h.user = { id: OWNER };
      const res = await put({ itemId: "10770", basePoint: 150 });
      expect(res.status).toBe(200);
      expect(h.inserted).toMatchObject({ eventKey: EVENT_KEY, itemId: "10770", basePoint: 150, source: "manual" });
      expect(h.inserted?.updatedAt).toBeInstanceOf(Date);
      expect((h.upsertTarget as Array<{ name: string }>).map((c) => c.name)).toEqual(["event_key", "item_id"]);
      expect(await res.json()).toMatchObject({ item: { itemId: "10770", basePoint: 150, source: "manual" } });
    });

    it("運営者でも不正な本文（basePoint 0）→ 400 で書かない", async () => {
      h.user = { id: OWNER };
      expect((await put({ itemId: "10770", basePoint: 0 })).status).toBe(400);
      expect(h.inserted).toBeNull();
    });

    it("未ログイン → 401（運営者判定より前）で DB に触れない", async () => {
      h.user = null;
      expect((await put()).status).toBe(401);
      expect(h.dbCalls).toBe(0);
    });
  });

  describe("DELETE", () => {
    it("運営者以外 → 403（code: OWNER_ONLY）で DB に触れない", async () => {
      const res = await del();
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "OWNER_ONLY" });
      expect(h.dbCalls).toBe(0);
      expect(h.deleteWhere).toBeNull();
    });

    it("運営者 → そのイベント・そのアイテムの行だけ消す", async () => {
      h.user = { id: OWNER };
      const res = await del("10770");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ deleted: 1 });
      const q = new PgDialect().sqlToQuery(h.deleteWhere as SQL);
      expect(q.params).toEqual([EVENT_KEY, "10770"]);
      expect(q.sql).toContain('"event_item_points"."event_key" = $1');
      expect(q.sql).toContain('"event_item_points"."item_id" = $2');
    });

    it("運営者でも itemId なし → 400 で DB に触れない", async () => {
      h.user = { id: OWNER };
      expect((await del("")).status).toBe(400);
      expect(h.dbCalls).toBe(0);
    });

    it("未ログイン → 401 で DB に触れない", async () => {
      h.user = null;
      expect((await del()).status).toBe(401);
      expect(h.dbCalls).toBe(0);
    });
  });
});
