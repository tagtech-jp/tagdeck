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

import { runRankingSync } from "./worker";

describe("runRankingSync (scheduled)", () => {
  beforeEach(() => {
    lockExecuteMock.mockReset();
    selectMock.mockReset();
    transactionMock.mockClear();
    syncMock.mockReset();
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
