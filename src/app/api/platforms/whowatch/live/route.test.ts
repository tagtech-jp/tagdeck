import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WhowatchLiveLookup } from "@/lib/whowatch/live-feed";

const h = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  rows: [] as Array<{ whowatchUserId: string | null }>,
  fetchLiveId: vi.fn<(id: string) => Promise<WhowatchLiveLookup>>(),
  selectCalls: 0,
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }) }));
vi.mock("@/lib/db/client", () => ({
  createDbClient: () => ({
    select: () => {
      h.selectCalls++;
      return { from: () => ({ where: () => ({ limit: async () => h.rows }) }) };
    },
  }),
}));
vi.mock("@/lib/whowatch/live-feed", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/whowatch/live-feed")>()),
  fetchLiveId: (id: string) => h.fetchLiveId(id),
}));

import { GET } from "./route";

const URL_ = "https://tagdeck.jp/api/platforms/whowatch/live";
const LIVE: WhowatchLiveLookup = { found: true, liveId: "76257563", title: "難しい", startedAt: 1790008662000, displayName: "トーマス", userPath: "w:Thomas19981022" };
const OFFLINE: WhowatchLiveLookup = { found: true, liveId: null, title: null, startedAt: null, displayName: "えるぴ", userPath: "t:kuroppi1022" };
const NOT_FOUND: WhowatchLiveLookup = { found: false, liveId: null, title: null, startedAt: null, displayName: null, userPath: null };

describe("GET /api/platforms/whowatch/live", () => {
  beforeEach(() => {
    h.user = { id: "user-1" };
    h.rows = [{ whowatchUserId: "kuroppi1022" }];
    h.selectCalls = 0;
    h.fetchLiveId.mockReset();
  });

  it("?userId 無しは設定のIDを使い isOther=false", async () => {
    h.fetchLiveId.mockResolvedValue(LIVE);
    const res = await GET(new Request(URL_));
    expect(res.status).toBe(200);
    expect(h.fetchLiveId).toHaveBeenCalledWith("kuroppi1022");
    expect(await res.json()).toMatchObject({ found: true, isLive: true, liveId: "76257563", isOther: false, whowatchUserId: "kuroppi1022" });
  });

  it("?userId が別人なら isOther=true（保存しないことを画面が判断できる）", async () => {
    h.fetchLiveId.mockResolvedValue(LIVE);
    const res = await GET(new Request(`${URL_}?userId=Thomas19981022`));
    expect(res.status).toBe(200);
    expect(h.fetchLiveId).toHaveBeenCalledWith("Thomas19981022");
    expect(await res.json()).toMatchObject({ isOther: true, displayName: "トーマス", whowatchUserId: "Thomas19981022" });
  });

  it("?userId に自分のIDを手入力した場合は isOther=false（他人扱いで縮退させない）", async () => {
    // 他人扱いになると dryRun で記録されず、ポーリングも 10 秒固定に落ちる
    h.fetchLiveId.mockResolvedValue(OFFLINE); // userPath: t:kuroppi1022 ＝ 設定値 kuroppi1022 と同一人物
    const res = await GET(new Request(`${URL_}?userId=kuroppi1022`));
    expect(res.status).toBe(200);
    expect(h.selectCalls).toBe(1); // 自分かどうか判定するため設定を読む
    expect(await res.json()).toMatchObject({ isOther: false });
  });

  it("設定が未登録なら ?userId 指定は他人として扱う（安全側）", async () => {
    h.rows = [{ whowatchUserId: null }];
    h.fetchLiveId.mockResolvedValue(LIVE);
    expect(await (await GET(new Request(`${URL_}?userId=Thomas19981022`))).json()).toMatchObject({ isOther: true });
  });

  it("ユーザーは居るが非配信 → 200・found=true・isLive=false・表示名つき", async () => {
    h.fetchLiveId.mockResolvedValue(OFFLINE);
    const res = await GET(new Request(`${URL_}?userId=kuroppi1022`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ found: true, isLive: false, liveId: null, displayName: "えるぴ" });
  });

  it("ユーザー不在 → 404・found=false（非配信と別扱い）", async () => {
    h.fetchLiveId.mockResolvedValue(NOT_FOUND);
    const res = await GET(new Request(`${URL_}?userId=no_such_user`));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain("見つかりません");
  });

  it("パスとして不正な userId は 400（API を叩かない）", async () => {
    for (const bad of ["../etc", "w:", "a/b", "日本語"]) {
      const res = await GET(new Request(`${URL_}?userId=${encodeURIComponent(bad)}`));
      expect(res.status, bad).toBe(400);
    }
    expect(h.fetchLiveId).not.toHaveBeenCalled();
  });

  it("未設定は 400、未ログインは 401", async () => {
    h.rows = [{ whowatchUserId: null }];
    expect((await GET(new Request(URL_))).status).toBe(400);
    h.user = null;
    expect((await GET(new Request(URL_))).status).toBe(401);
  });
});
