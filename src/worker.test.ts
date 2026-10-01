import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// .open-next/worker.js はビルド後にのみ存在する生成物なのでテストでは実体をモックする
// (fetchハンドラの再エクスポート先。runRankingSyncのテストでは使わない)
vi.mock("../.open-next/worker.js", () => ({ default: { fetch: vi.fn() } }));

// pg_try_advisory_xact_lock の戻り値をテストごとに差し替えられるようにする
const lockExecuteMock = vi.fn();
const selectMock = vi.fn();
const transactionMock = vi.fn(async (cb: (tx: unknown) => unknown) => {
  const tx = { execute: lockExecuteMock, select: () => ({ from: () => ({ where: selectMock }) }) };
  return cb(tx);
});
vi.mock("@/lib/db/client", () => ({
  createDbClient: () => ({ transaction: transactionMock }),
}));
const syncMock = vi.fn();
vi.mock("@/lib/whowatch/ranking-sync", () => ({
  syncSimulatorRanking: (...args: unknown[]) => syncMock(...args),
}));
// 区分の自動設定（2026-10-01）。RANKING_EVENT_TYPES は worker.ts の「区分が空」の数え方にも使うので本物と同じ値を出す
const autoAssignMock = vi.fn();
vi.mock("@/lib/whowatch/auto-ranking-type", () => ({
  RANKING_EVENT_TYPES: ["ranking", "nice", "viewer"],
  autoAssignRankingTypes: (...args: unknown[]) => autoAssignMock(...args),
}));

import { runRankingSync } from "./worker";

describe("runRankingSync (scheduled)", () => {
  beforeEach(() => {
    lockExecuteMock.mockReset();
    selectMock.mockReset();
    transactionMock.mockClear();
    syncMock.mockReset();
    autoAssignMock.mockReset();
    autoAssignMock.mockResolvedValue({ assigned: [], repaired: [], skipped: [] });
    for (const k of ["DATABASE_URL", "SOME_VAR"]) delete process.env[k];
  });
  afterEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.SOME_VAR;
  });

  it("env の文字列値を process.env へ補完する(既存値は上書きしない)", async () => {
    process.env.SOME_VAR = "already-set";
    lockExecuteMock.mockResolvedValue([{ locked: true }]);
    selectMock.mockResolvedValue([]);
    await runRankingSync({ DATABASE_URL: "postgres://example", SOME_VAR: "from-env-binding", NUMERIC: 42 });
    expect(process.env.DATABASE_URL).toBe("postgres://example");
    expect(process.env.SOME_VAR).toBe("already-set");
    expect(process.env.NUMERIC).toBeUndefined();
  });

  it("ロック取得成功 → トランザクション内で対象抽出・同期を行う", async () => {
    lockExecuteMock.mockResolvedValue([{ locked: true }]);
    selectMock.mockResolvedValue([
      { id: "sim-1", rankingType: "autumncollection_1st_overall", userId: "u1" },
    ]);
    syncMock.mockResolvedValue({ myEntry: null, snapshotId: null });

    await runRankingSync({});

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(lockExecuteMock).toHaveBeenCalledTimes(1);
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(syncMock).toHaveBeenCalledTimes(1);
  });

  it("ロック取得失敗(前回実行中) → 対象抽出・同期をスキップする", async () => {
    lockExecuteMock.mockResolvedValue([{ locked: false }]);

    await runRankingSync({});

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(lockExecuteMock).toHaveBeenCalledTimes(1);
    expect(selectMock).not.toHaveBeenCalled();
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("1件の同期が失敗しても残りは継続する(例外を外に投げない)", async () => {
    lockExecuteMock.mockResolvedValue([{ locked: true }]);
    selectMock.mockResolvedValue([
      { id: "sim-1", rankingType: "a", userId: "u1" },
      { id: "sim-2", rankingType: "b", userId: "u2" },
    ]);
    syncMock.mockRejectedValueOnce(new Error("whowatch API down")).mockResolvedValueOnce({ myEntry: null, snapshotId: null });

    await expect(runRankingSync({})).resolves.toBeUndefined();
    expect(syncMock).toHaveBeenCalledTimes(2);
  });
});

describe("runRankingSync（区分が空のイベントを数える・2026-09-30）", () => {
  beforeEach(() => {
    lockExecuteMock.mockReset();
    selectMock.mockReset();
    syncMock.mockReset();
    autoAssignMock.mockReset();
    autoAssignMock.mockResolvedValue({ assigned: [], repaired: [], skipped: [] });
  });

  it("ranking_type が空のものは同期しない。ランキング型のふわっちイベントならログに件数と id を出す", async () => {
    lockExecuteMock.mockResolvedValue([{ locked: true }]);
    selectMock.mockResolvedValue([
      { id: "sim-with-type", rankingType: "wolfcoming_all", platform: "whowatch", eventType: "ranking" },
      { id: "74671ff8-wolf", rankingType: null, platform: "whowatch", eventType: "ranking" },
      { id: "score-event", rankingType: null, platform: "whowatch", eventType: "score" },
    ]);
    syncMock.mockResolvedValue({ myEntry: null, snapshotId: null });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await runRankingSync({});
    expect(syncMock).toHaveBeenCalledTimes(1);
    expect(syncMock.mock.calls[0][1]).toMatchObject({ id: "sim-with-type" });
    expect(log).toHaveBeenCalledWith("[ranking-sync/scheduled] targets=1 ok=1 failed=0 no_ranking_type=1");
    expect(warn.mock.calls.some((c) => String(c[0]).includes("74671ff8") && !String(c[0]).includes("score-ev"))).toBe(true);
    log.mockRestore();
    warn.mockRestore();
  });
});

describe("runRankingSync（区分の自動設定・2026-10-01）", () => {
  beforeEach(() => {
    lockExecuteMock.mockReset();
    selectMock.mockReset();
    transactionMock.mockClear();
    syncMock.mockReset();
    autoAssignMock.mockReset();
  });

  it("同期のトランザクションより前に区分を自動で入れ、入れた区分と取り直したイベントをログに出す", async () => {
    autoAssignMock.mockResolvedValue({
      assigned: [{ id: "49a163c8-0000-4000-8000-000000000000", rankingType: "magicfantasy_1st_overall" }],
      repaired: ["2026_10_magicfantasy"],
      skipped: [{ id: "deadbeef-0000", reason: "区分の構造がまだ取れていない" }],
    });
    lockExecuteMock.mockResolvedValue([{ locked: true }]);
    selectMock.mockResolvedValue([{ id: "49a163c8-0000-4000-8000-000000000000", rankingType: "magicfantasy_1st_overall", platform: "whowatch", eventType: "ranking" }]);
    syncMock.mockResolvedValue({ myEntry: null, snapshotId: null });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await runRankingSync({});

    expect(autoAssignMock).toHaveBeenCalledTimes(1);
    expect(autoAssignMock.mock.calls[0][1]).toBeInstanceOf(Date);
    expect(autoAssignMock.mock.invocationCallOrder[0]).toBeLessThan(transactionMock.mock.invocationCallOrder[0]);
    expect(log).toHaveBeenCalledWith("[ranking-sync/scheduled] auto ranking_type assigned=49a163c8:magicfantasy_1st_overall repaired=2026_10_magicfantasy");
    expect(warn).toHaveBeenCalledWith("[ranking-sync/scheduled] auto ranking_type skipped=deadbeef:区分の構造がまだ取れていない");
    expect(log).toHaveBeenCalledWith("[ranking-sync/scheduled] targets=1 ok=1 failed=0 no_ranking_type=0");
    log.mockRestore();
    warn.mockRestore();
  });

  it("自動設定が失敗しても順位の同期は続ける", async () => {
    autoAssignMock.mockRejectedValue(new Error("Network connection lost."));
    lockExecuteMock.mockResolvedValue([{ locked: true }]);
    selectMock.mockResolvedValue([{ id: "sim-1", rankingType: "a", platform: "whowatch", eventType: "ranking" }]);
    syncMock.mockResolvedValue({ myEntry: null, snapshotId: null });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(runRankingSync({})).resolves.toBeUndefined();

    expect(warn.mock.calls.some((c) => String(c[0]).includes("auto ranking_type failed"))).toBe(true);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(syncMock).toHaveBeenCalledTimes(1);
    log.mockRestore();
    warn.mockRestore();
  });

  it("順位の同期の失敗ログに SQL 全文・params を出さない", async () => {
    autoAssignMock.mockResolvedValue({ assigned: [], repaired: [], skipped: [] });
    lockExecuteMock.mockResolvedValue([{ locked: true }]);
    selectMock.mockResolvedValue([{ id: "sim-1", rankingType: "a", platform: "whowatch", eventType: "ranking" }]);
    syncMock.mockRejectedValue(new Error('Failed query: insert into "ranking_snapshots" values ($1)\nparams: x'));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await runRankingSync({});

    const failed = warn.mock.calls.find((c) => c[0] === "[ranking-sync/scheduled] failed");
    expect(failed?.slice(1)).toEqual(["sim-1", "Failed query"]);
    log.mockRestore();
    warn.mockRestore();
  });

  it("何も入れず何も飛ばさなかった回は自動設定のログを出さない", async () => {
    autoAssignMock.mockResolvedValue({ assigned: [], repaired: [], skipped: [] });
    lockExecuteMock.mockResolvedValue([{ locked: true }]);
    selectMock.mockResolvedValue([]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await runRankingSync({});

    expect([...log.mock.calls, ...warn.mock.calls].some((c) => String(c[0]).includes("auto ranking_type"))).toBe(false);
    log.mockRestore();
    warn.mockRestore();
  });
});
