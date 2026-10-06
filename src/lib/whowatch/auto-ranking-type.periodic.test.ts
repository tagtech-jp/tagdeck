import { beforeEach, describe, expect, it, vi } from "vitest";

// N-1 グランプリの部門の自動判定と、WGP の既定（デイリー）（2026-10-07 社長指示「WGP のランキングも対応して、ナイスも対応して」）。
// 同日の社長報告「N-1 の部門が自動判定のままで入らない」（本人が上位 100 名の外）を受け、公開プロフィールの性別と publisher_id の本人の行で判定する
const getRankingsMock = vi.fn();
const getPublicProfileMock = vi.fn();
vi.mock("./rankings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./rankings")>();
  return { ...actual, getRankings: (...args: unknown[]) => getRankingsMock(...args) };
});
vi.mock("./event-detail-sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./event-detail-sync")>();
  return { ...actual, syncEventDetail: vi.fn() };
});
vi.mock("./profile", () => ({ getPublicProfile: (...args: unknown[]) => getPublicProfileMock(...args) }));

import { eventSimulators, streamerProfiles, whowatchEvents } from "@/lib/db/schema";
import { AUTO_LIMITED_SCAN_MAX_PER_RUN, autoAssignRankingTypes, decideN1RankingType } from "./auto-ranking-type";
import { N1_STRUCT_KEY, WGP_STRUCT_KEY } from "./periodic-ranking";
import type { RankingEntryApi } from "./rankings";

const ME = "kuroppi1022";
const PROFILE = { userId: "74338319", userPath: "t:kuroppi1022", name: "えるぴ", gender: "male" as "male" | "female" | null, publishGradeName: "ゴールド+", liveHistoryCount: 11 };
/** 2026-10-07 12:00 JST。N-1 のシミュレーターは 1 回目（10/1 0:00 〜 10/11 0:00 JST） */
const NOW = new Date("2026-10-07T03:00:00.000Z");
const N1_SIM = { id: "sim-n1", startTime: new Date("2026-09-30T15:00:00.000Z"), endTime: new Date("2026-10-10T15:00:00.000Z"), whowatchEventId: 31, userId: "user-1", myEntryName: null as string | null };
const WGP_SIM = { id: "sim-wgp", startTime: new Date("2026-10-06T15:00:00.000Z"), endTime: new Date("2026-10-07T15:00:00.000Z"), whowatchEventId: 1531, userId: "user-1", myEntryName: null as string | null };
const WINDOW = { start: N1_SIM.startTime, end: N1_SIM.endTime };

const entry = (userPath: string, rank: number): RankingEntryApi => ({ rank, point: 100 * rank, userId: null, userPath, name: userPath, totalViewCount: null });
/** 部門別の順位表（種別 n1-{division} の部門で分ける）。inList = 上位 100 名に本人が居る部門、viaPublisher = 圏外だが publisher_ranking に本人の行がある部門 */
function rankingsByDivision(inList: string[], viaPublisher: string[] = []) {
  return async (type: string) => {
    const division = type.split("-")[1];
    const entries = [entry("w:other1", 1), entry("w:other2", 2)];
    if (inList.includes(division)) entries.push(entry(`t:${ME}`, 3));
    const publisher = viaPublisher.includes(division) ? { rank: 570, point: 4, userId: "74338319", userPath: `t:${ME}`, name: "えるぴ", totalViewCount: 0 } : null;
    return { rankingType: `${type}-202610-1st`, title: "", status: 1, entries, publisher, fetchedAt: NOW.toISOString() };
  };
}

type Row = Record<string, unknown>;
function n1EventRow(over: Row = {}): Row {
  return {
    id: 31,
    eventKey: "nice_one_ranking",
    name: "N-1 グランプリ",
    titleJa: null,
    shortName: "N-1 グランプリ",
    status: "open",
    startedAt: new Date("2026-09-30T15:00:00.000Z"),
    endedAt: new Date("2026-10-31T14:59:59.000Z"),
    kind: "long",
    rankingPrefix: "n1",
    struct: { [N1_STRUCT_KEY]: { eventKey: "nice_one_ranking" } },
    rulesText: null,
    rulesHtml: null,
    rulesParsed: null,
    periods: [],
    detailFetchedAt: new Date("2026-10-07T00:10:00.000Z"),
    ...over,
  };
}
function wgpEventRow(over: Row = {}): Row {
  return {
    ...n1EventRow(),
    id: 1531,
    eventKey: "2026_10_whowatchgrandprix",
    name: "WhoWatch GRAND PRIX",
    shortName: "WhoWatch GRAND PRIX",
    rankingPrefix: "wgp",
    struct: { [WGP_STRUCT_KEY]: { eventKey: "2026_10_whowatchgrandprix", month: "202610" } },
    ...over,
  };
}

function fakeDb(sims: Row[], events: Row[], whowatchUserId: string | null) {
  const updates: Row[] = [];
  const db = {
    select: () => ({
      from: (table: unknown) => {
        if (table === eventSimulators) {
          const chain = { innerJoin: () => chain, where: () => chain, orderBy: () => chain, limit: async () => sims };
          return chain;
        }
        if (table === streamerProfiles) return { where: () => ({ limit: async () => [{ whowatchUserId }] }) };
        expect(table).toBe(whowatchEvents);
        return { where: async () => events };
      },
    }),
    update: () => ({
      set: (v: Row) => ({
        where: () => ({
          returning: async () => {
            updates.push(v);
            return [{ id: sims[updates.length - 1]?.id }];
          },
        }),
      }),
    }),
  };
  return { db: db as unknown as Parameters<typeof autoAssignRankingTypes>[0], updates };
}

describe("autoAssignRankingTypes（N-1 の部門判定）", () => {
  beforeEach(() => {
    getRankingsMock.mockReset();
    getPublicProfileMock.mockReset();
    getPublicProfileMock.mockResolvedValue(PROFILE);
  });

  it("上位 100 名の外でも、ルーキー部門の publisher_ranking に本人の行があればルーキー（数値 ID を publisher_id に渡す）", async () => {
    getRankingsMock.mockImplementation(rankingsByDivision([], ["rookie", "male"]));
    const { db, updates } = fakeDb([N1_SIM], [n1EventRow()], ME);
    const r = await autoAssignRankingTypes(db, NOW);
    expect(r.assigned).toEqual([{ id: N1_SIM.id, rankingType: "n1-rookie" }]);
    expect(r.skipped).toEqual([]);
    expect(updates).toEqual([{ rankingType: "n1-rookie", updatedAt: NOW }]);
    expect(getPublicProfileMock).toHaveBeenCalledWith(ME);
    // ルーキーで見つかった時点で探すのをやめる。期間はシミュレーターの期間に収めて決める
    expect(getRankingsMock.mock.calls.map((c) => c[0])).toEqual(["n1-rookie"]);
    expect(getRankingsMock).toHaveBeenNthCalledWith(1, "n1-rookie", { limit: 100, now: NOW, window: WINDOW, publisherId: "74338319" });
  });

  it("ルーキーに居なければプロフィールの性別で決める（男性 → n1-male。順位表に 1 件も載っていなくても決まる）", async () => {
    getRankingsMock.mockImplementation(rankingsByDivision([]));
    const { db, updates } = fakeDb([N1_SIM], [n1EventRow()], ME);
    const r = await autoAssignRankingTypes(db, NOW);
    expect(r.assigned).toEqual([{ id: N1_SIM.id, rankingType: "n1-male" }]);
    expect(updates).toEqual([{ rankingType: "n1-male", updatedAt: NOW }]);
    expect(getRankingsMock.mock.calls.map((c) => c[0])).toEqual(["n1-rookie"]);
  });

  it("性別が女性なら n1-female", async () => {
    getPublicProfileMock.mockResolvedValue({ ...PROFILE, gender: "female" });
    getRankingsMock.mockImplementation(rankingsByDivision([]));
    const { db } = fakeDb([N1_SIM], [n1EventRow()], ME);
    const r = await autoAssignRankingTypes(db, NOW);
    expect(r.assigned).toEqual([{ id: N1_SIM.id, rankingType: "n1-female" }]);
  });

  it("性別が未設定なら男性・女性の順位表に本人の行があるかで決める（圏外でも publisher_ranking で見つかる）", async () => {
    getPublicProfileMock.mockResolvedValue({ ...PROFILE, gender: null });
    getRankingsMock.mockImplementation(rankingsByDivision([], ["female"]));
    const { db } = fakeDb([N1_SIM], [n1EventRow()], ME);
    const r = await autoAssignRankingTypes(db, NOW);
    expect(r.assigned).toEqual([{ id: N1_SIM.id, rankingType: "n1-female" }]);
    expect(getRankingsMock.mock.calls.map((c) => c[0])).toEqual(["n1-rookie", "n1-male", "n1-female"]);
  });

  it("性別が未設定でどの部門にも本人の行が無ければ入れずに理由を返す（性別の設定か手動選択を案内）", async () => {
    getPublicProfileMock.mockResolvedValue({ ...PROFILE, gender: null });
    getRankingsMock.mockImplementation(rankingsByDivision([]));
    const { db, updates } = fakeDb([N1_SIM], [n1EventRow()], ME);
    const r = await autoAssignRankingTypes(db, NOW);
    expect(r.assigned).toEqual([]);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].reason).toContain("性別");
    expect(updates).toEqual([]);
    expect(getRankingsMock.mock.calls.map((c) => c[0])).toEqual(["n1-rookie", "n1-male", "n1-female"]);
  });

  it("プロフィールが取れなくても（ID 間違い・通信失敗）、上位 100 名の中に本人が居れば判定できる（publisher_id は付けない）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getPublicProfileMock.mockRejectedValue(new Error("HTTP 503"));
    getRankingsMock.mockImplementation(rankingsByDivision(["male"]));
    const { db } = fakeDb([N1_SIM], [n1EventRow()], ME);
    const r = await autoAssignRankingTypes(db, NOW);
    expect(r.assigned).toEqual([{ id: N1_SIM.id, rankingType: "n1-male" }]);
    expect(getRankingsMock).toHaveBeenNthCalledWith(1, "n1-rookie", { limit: 100, now: NOW, window: WINDOW });
    warn.mockRestore();
  });

  it("ふわっち ID も表示名も無ければ判定できない（順位表もプロフィールも取りに行かない）", async () => {
    getRankingsMock.mockImplementation(rankingsByDivision(["male"]));
    const { db } = fakeDb([N1_SIM], [n1EventRow()], null);
    const r = await autoAssignRankingTypes(db, NOW);
    expect(r.skipped[0].reason).toContain("ふわっち ID が未設定");
    expect(getRankingsMock).not.toHaveBeenCalled();
    expect(getPublicProfileMock).not.toHaveBeenCalled();
  });

  it("部門判定は 1 回の同期で上限件数まで。超えた分は次回に回す", async () => {
    expect(AUTO_LIMITED_SCAN_MAX_PER_RUN).toBe(2);
    getRankingsMock.mockImplementation(rankingsByDivision([], ["rookie"]));
    const sims = [N1_SIM, { ...N1_SIM, id: "sim-2" }, { ...N1_SIM, id: "sim-3" }];
    const { db } = fakeDb(sims, [n1EventRow()], ME);
    const r = await autoAssignRankingTypes(db, NOW);
    expect(r.assigned.map((a) => a.rankingType)).toEqual(["n1-rookie", "n1-rookie"]);
    expect(r.skipped).toEqual([{ id: "sim-3", reason: "今回の部門判定の上限（次回の同期で判定）" }]);
    // プロフィールは利用者ごとに 1 回だけ
    expect(getPublicProfileMock).toHaveBeenCalledTimes(1);
  });

  it("WGP は順位表もプロフィールも見ずに先頭のデイリー（wgp-daily）を入れる", async () => {
    const { db, updates } = fakeDb([WGP_SIM], [wgpEventRow()], ME);
    const r = await autoAssignRankingTypes(db, NOW);
    expect(r.assigned).toEqual([{ id: WGP_SIM.id, rankingType: "wgp-daily" }]);
    expect(updates).toEqual([{ rankingType: "wgp-daily", updatedAt: NOW }]);
    expect(getRankingsMock).not.toHaveBeenCalled();
    expect(getPublicProfileMock).not.toHaveBeenCalled();
  });

  it("WGP の struct がまだ無い（同期前の行）ときは、構造が取れていない扱いで次回へ", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db } = fakeDb([WGP_SIM], [wgpEventRow({ struct: null })], ME);
    const r = await autoAssignRankingTypes(db, NOW);
    expect(r.skipped).toEqual([{ id: WGP_SIM.id, reason: "区分の構造がまだ取れていない" }]);
    warn.mockRestore();
  });
});

describe("decideN1RankingType", () => {
  it("表示名だけでも判定できる。順位表の取得に失敗した部門は空扱いで次へ。性別が無ければ男女の順位表で決める", async () => {
    const lookup = async (type: string) => (type === "n1-rookie" ? Promise.reject(new Error("HTTP 502")) : (await rankingsByDivision(["male"])(type)).entries);
    const d = await decideN1RankingType({ ...N1_SIM, whowatchUserId: null, myEntryName: `t:${ME}` }, async (t) => lookup(t).catch(() => []), null);
    expect(d).toEqual({ id: N1_SIM.id, rankingType: "n1-male", optionKey: "male" });
  });

  it("性別があれば順位表に居なくてもその部門。ルーキーに居ればルーキーを優先", async () => {
    const none = async () => [] as RankingEntryApi[];
    expect(await decideN1RankingType({ ...N1_SIM, whowatchUserId: ME, myEntryName: null }, none, { gender: "female" })).toEqual({ id: N1_SIM.id, rankingType: "n1-female", optionKey: "female" });
    const rookieHasMe = async (type: string) => (type === "n1-rookie" ? [entry(`t:${ME}`, 7)] : []);
    expect(await decideN1RankingType({ ...N1_SIM, whowatchUserId: ME, myEntryName: null }, rookieHasMe, { gender: "male" })).toEqual({ id: N1_SIM.id, rankingType: "n1-rookie", optionKey: "rookie" });
  });
});
