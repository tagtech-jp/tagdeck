import { describe, expect, it } from "vitest";
import { isFunctionMissingError, listAllOwnStorageObjects, type StorageListResult } from "./delete-account";

describe("listAllOwnStorageObjects（本人の音源のパスを全部集める）", () => {
  it("ページが上限いっぱいなら次のページも読み、フォルダは飛ばし、{userId}/{name} の形で返す", async () => {
    const pages: StorageListResult[] = [
      { data: [{ name: "a.mp3", id: "1" }, { name: "sub", id: null }], error: null },
      { data: [{ name: "b.wav", id: "2" }, { name: "c.ogg", id: "3" }], error: null },
      { data: [{ name: "d.m4a", id: "4" }], error: null },
    ];
    const calls: Array<{ limit: number; offset: number }> = [];
    const paths = await listAllOwnStorageObjects(
      async (opts) => {
        calls.push(opts);
        return pages.shift() ?? { data: [], error: null };
      },
      "u1",
      2,
    );
    expect(paths).toEqual(["u1/a.mp3", "u1/b.wav", "u1/c.ogg", "u1/d.m4a"]);
    expect(calls).toEqual([
      { limit: 2, offset: 0 },
      { limit: 2, offset: 2 },
      { limit: 2, offset: 4 },
    ]);
  });

  it("空なら 1 回読んで空を返す", async () => {
    let calls = 0;
    const paths = await listAllOwnStorageObjects(async () => {
      calls++;
      return { data: [], error: null };
    }, "u1");
    expect(paths).toEqual([]);
    expect(calls).toBe(1);
  });

  it("data が null でも落ちない", async () => {
    expect(await listAllOwnStorageObjects(async () => ({ data: null, error: null }), "u1")).toEqual([]);
  });

  it("一覧の失敗は Error で投げる（呼び出し元が 502 にする）", async () => {
    await expect(listAllOwnStorageObjects(async () => ({ data: null, error: { message: "bucket not found" } }), "u1")).rejects.toThrow(
      "bucket not found",
    );
  });
});

describe("isFunctionMissingError（drizzle/0026 が未適用か）", () => {
  it("PostgREST の PGRST202・PostgreSQL の 42883・「Could not find the function」は未適用", () => {
    expect(isFunctionMissingError({ code: "PGRST202", message: "Could not find the function public.delete_own_account without parameters in the schema cache" })).toBe(true);
    expect(isFunctionMissingError({ code: "42883", message: "function public.delete_own_account() does not exist" })).toBe(true);
    expect(isFunctionMissingError({ code: null, message: "Could not find the function public.delete_own_account" })).toBe(true);
  });

  it("権限エラー・タイムアウト・エラー無しは未適用ではない", () => {
    expect(isFunctionMissingError({ code: "42501", message: "permission denied for table users" })).toBe(false);
    expect(isFunctionMissingError({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(false);
    expect(isFunctionMissingError({ message: "" })).toBe(false);
    expect(isFunctionMissingError(null)).toBe(false);
    expect(isFunctionMissingError(undefined)).toBe(false);
  });
});
