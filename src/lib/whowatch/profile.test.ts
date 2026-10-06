import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearPublicProfileCache, genderFromLabel, getPublicProfile, normalizePublicProfile, WhowatchProfileApiError } from "./profile";

// 2026-10-07 実応答（GET /users/t:kuroppi1022/profile）の縮約。名前は仮名
const PROFILE = {
  account_name: "@kuroppi1022",
  user_id: 74338319,
  user_path: "t:kuroppi1022",
  name: "えるぴ",
  gender: "男性",
  publish_grade_name: "ゴールド+",
  live_history_count: 11,
  live: { id: 76658050, title: "x" },
};
// prefix 違い（/users/kuroppi1022/profile）は HTTP 200 で各項目が null の空応答
const EMPTY = { account_name: null, user_id: null, user_path: null, name: null, gender: null };

describe("normalizePublicProfile", () => {
  it("数値 ID・パス・性別・グレードを取り出す。性別は 男性 → male、女性 → female、未設定 → null", () => {
    expect(normalizePublicProfile(PROFILE)).toEqual({ userId: "74338319", userPath: "t:kuroppi1022", name: "えるぴ", gender: "male", publishGradeName: "ゴールド+", liveHistoryCount: 11 });
    expect(normalizePublicProfile({ ...PROFILE, gender: "女性" })?.gender).toBe("female");
    expect(normalizePublicProfile({ ...PROFILE, gender: "未設定" })?.gender).toBeNull();
    expect(normalizePublicProfile({ ...PROFILE, gender: undefined })?.gender).toBeNull();
    expect(genderFromLabel(" 男性 ")).toBe("male");
    expect(genderFromLabel("female")).toBe("female");
    expect(genderFromLabel(1)).toBeNull();
  });

  it("空応答・error_code・配列は null", () => {
    expect(normalizePublicProfile(EMPTY)).toBeNull();
    expect(normalizePublicProfile({ error_code: "U-002", error_message: "x" })).toBeNull();
    expect(normalizePublicProfile([])).toBeNull();
    expect(normalizePublicProfile(null)).toBeNull();
    // user_id が文字列の数字でも通す
    expect(normalizePublicProfile({ ...PROFILE, user_id: "74338319" })?.userId).toBe("74338319");
  });
});

describe("getPublicProfile", () => {
  let originalFetch: typeof global.fetch;
  beforeEach(() => {
    originalFetch = global.fetch;
    clearPublicProfileCache();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("prefix 無しの ID は w: → t: の順に試し、空応答を飛ばして見つけた方を返す。結果は 10 分キャッシュ", async () => {
    const seen: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const u = new URL(String(url));
      seen.push(decodeURIComponent(u.pathname));
      return new Response(JSON.stringify(u.pathname.includes("t%3A") || u.pathname.includes("t:") ? PROFILE : EMPTY), { status: 200 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const p = await getPublicProfile("kuroppi1022");
    expect(p).toMatchObject({ userId: "74338319", gender: "male" });
    expect(seen).toEqual(["/users/w:kuroppi1022/profile", "/users/t:kuroppi1022/profile"]);
    await getPublicProfile("kuroppi1022");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("@ 付きや URL でも同じ。数値 ID は 1 候補だけ", async () => {
    const seen: string[] = [];
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      seen.push(decodeURIComponent(new URL(String(url)).pathname));
      return new Response(JSON.stringify(PROFILE), { status: 200 });
    }) as unknown as typeof fetch;
    expect((await getPublicProfile("74338319"))?.userId).toBe("74338319");
    expect((await getPublicProfile("https://whowatch.tv/profile/t:kuroppi1022"))?.userPath).toBe("t:kuroppi1022");
    expect(seen).toEqual(["/users/74338319/profile", "/users/t:kuroppi1022/profile"]);
  });

  it("どの候補も空なら null（ID 間違い）。HTTP エラーは例外", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify(EMPTY), { status: 200 })) as unknown as typeof fetch;
    expect(await getPublicProfile("nobody_xyz")).toBeNull();
    global.fetch = vi.fn(async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    clearPublicProfileCache();
    const err = await getPublicProfile("nobody_xyz").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WhowatchProfileApiError);
    expect(await getPublicProfile("")).toBeNull();
  });
});
