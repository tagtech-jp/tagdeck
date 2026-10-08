import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// サーバ側の Supabase（getUser / storage.list / storage.remove / rpc / signOut）を差し替える
type ListPage = { data: Array<{ name: string; id: string | null }> | null; error: { message: string } | null };
type RpcResult = { data: unknown; error: { code?: string | null; message: string } | null };
const h = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  listPages: [] as ListPage[],
  listCalls: [] as Array<{ path: string; opts: unknown }>,
  removeCalls: [] as string[][],
  removeError: null as { message: string } | null,
  rpcResult: { data: null, error: null } as RpcResult,
  rpcCalls: [] as string[],
  signOutCalls: [] as unknown[],
  signOutThrows: false,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: h.user }, error: null }),
      signOut: async (opts: unknown) => {
        h.signOutCalls.push(opts);
        if (h.signOutThrows) throw new Error("network down");
        return { error: null };
      },
    },
    storage: {
      from: (bucket: string) => ({
        list: async (path: string, opts: unknown) => {
          h.listCalls.push({ path: `${bucket}:${path}`, opts });
          return h.listPages.shift() ?? { data: [], error: null };
        },
        remove: async (paths: string[]) => {
          h.removeCalls.push(paths);
          return { data: null, error: h.removeError };
        },
      }),
    },
    rpc: async (fn: string) => {
      h.rpcCalls.push(fn);
      return h.rpcResult;
    },
  }),
}));

import { POST } from "./route";

const URL_ = "https://tagdeck.jp/api/account/delete";
const call = (body?: unknown, raw?: string) =>
  POST(
    new Request(URL_, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    }),
  );
const DELETED = { user_id: "u1", events: 3, listeners: 2, users: 1, auth_users: 1 };

beforeEach(() => {
  h.user = { id: "u1" };
  h.listPages = [];
  h.listCalls = [];
  h.removeCalls = [];
  h.removeError = null;
  h.rpcResult = { data: DELETED, error: null };
  h.rpcCalls = [];
  h.signOutCalls = [];
  h.signOutThrows = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/account/delete（退会）", () => {
  it("ログインしていなければ 401。Storage にも DB にも触らない", async () => {
    h.user = null;
    const res = await call({ confirm: "削除" });
    expect(res.status).toBe(401);
    expect(h.listCalls).toHaveLength(0);
    expect(h.rpcCalls).toHaveLength(0);
  });

  it("確認の語が無い・違う・本文が JSON でないときは 400 で、何も消さない", async () => {
    expect((await call()).status).toBe(400);
    expect((await call({})).status).toBe(400);
    expect((await call({ confirm: "削除する" })).status).toBe(400);
    expect((await call({ confirm: true })).status).toBe(400);
    expect((await call(undefined, "{not json")).status).toBe(400);
    expect(h.listCalls).toHaveLength(0);
    expect(h.removeCalls).toHaveLength(0);
    expect(h.rpcCalls).toHaveLength(0);
  });

  it("音源を本人のフォルダから全部消し、関数を 1 回呼び、Cookie を消して 200 を返す", async () => {
    h.listPages = [{ data: [{ name: "pattern_1_1.mp3", id: "a" }, { name: "folder", id: null }, { name: "tier_T1_2.wav", id: "b" }], error: null }];
    const res = await call({ confirm: "削除" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ ok: true, deleted: DELETED, storageObjects: 2 });
    // 一覧は本人の id のフォルダだけ（他人のフォルダは RLS でも見えないが、頼んでもいない）
    expect(h.listCalls).toEqual([{ path: "se:u1", opts: { limit: 1000, offset: 0 } }]);
    expect(h.removeCalls).toEqual([["u1/pattern_1_1.mp3", "u1/tier_T1_2.wav"]]);
    expect(h.rpcCalls).toEqual(["delete_own_account"]);
    expect(h.signOutCalls).toEqual([{ scope: "local" }]);
  });

  it("音源が無ければ remove は呼ばない", async () => {
    const res = await call({ confirm: "削除" });
    expect(res.status).toBe(200);
    expect(h.removeCalls).toHaveLength(0);
    expect(h.rpcCalls).toEqual(["delete_own_account"]);
  });

  it("音源の一覧に失敗したら 502 で、DB は消さない（途中までの削除を残さない）", async () => {
    h.listPages = [{ data: null, error: { message: "Bucket not found" } }];
    const res = await call({ confirm: "削除" });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ reason: "storage_list" });
    expect(h.removeCalls).toHaveLength(0);
    expect(h.rpcCalls).toHaveLength(0);
  });

  it("音源の削除に失敗したら 502 で、DB は消さない", async () => {
    h.listPages = [{ data: [{ name: "x.mp3", id: "a" }], error: null }];
    h.removeError = { message: "new row violates row-level security policy" };
    const res = await call({ confirm: "削除" });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ reason: "storage_remove" });
    expect(h.rpcCalls).toHaveLength(0);
    expect(h.signOutCalls).toHaveLength(0);
  });

  it("関数が未適用（drizzle/0026 前・PGRST202）なら 503 で「準備中」。Cookie は消さない", async () => {
    h.rpcResult = { data: null, error: { code: "PGRST202", message: "Could not find the function public.delete_own_account without parameters in the schema cache" } };
    const res = await call({ confirm: "削除" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ reason: "function_missing" });
    expect(h.signOutCalls).toHaveLength(0);
  });

  it("関数が他の理由で失敗したら 500 と理由（エラーコード）。Cookie は消さない", async () => {
    h.rpcResult = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    const res = await call({ confirm: "削除" });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ reason: "57014" });
    expect(h.signOutCalls).toHaveLength(0);
  });

  it("削除後の signOut が失敗しても 200（削除自体は完了している）", async () => {
    h.signOutThrows = true;
    const res = await call({ confirm: "削除" });
    expect(res.status).toBe(200);
    expect(h.rpcCalls).toEqual(["delete_own_account"]);
  });
});
