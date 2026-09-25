import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chunkRows, estimateHit, flattenPatterns, planItemBatches, syncItemPatterns, ITEM_SYNC_CHUNK_SIZE, ITEM_SYNC_BATCH_LIMIT } from "./item-patterns-sync";

describe("estimateHit", () => {
  it("当たり語・ボーナス等級で is_hit、種類違いは is_variant", () => {
    expect(estimateHit({ name: "ひよこ", patternCount: 2 }, { name: "ひよこのあたり" })).toEqual({ isHit: true, grade: null, isVariant: false });
    expect(estimateHit({ name: "ボーナス", patternCount: 9 }, { name: "メガボーナス" })).toEqual({ isHit: true, grade: "メガ", isVariant: false });
    expect(estimateHit({ name: "風船", patternCount: 3 }, { name: "風船 × 10" })).toEqual({ isHit: false, grade: null, isVariant: true });
    expect(estimateHit({ name: "ひよこ", patternCount: 2 }, { name: "ひよこ" })).toEqual({ isHit: false, grade: null, isVariant: false });
  });
});

describe("flattenPatterns", () => {
  it("/playitems を pattern 行に平坦化する", () => {
    const now = new Date("2026-09-21T00:00:00Z");
    const rows = flattenPatterns([{ id: 98, name: "ひよこ", play_item_pattern: [{ id: 116, name: "ひよこ", quantity: 1 }, { id: 10365, name: "ひよこのあたり", quantity: 1, animation_url2: "a.png" }] }], now);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ patternId: 10365, itemId: 98, itemName: "ひよこ", patternName: "ひよこのあたり", isHit: true, animationUrl: "a.png", syncedAt: now });
  });
});

// 2026-09-22 本番障害の再発防止: 400 行/チャンクの単一 INSERT(4,800 bind パラメータ)が HTTP 502 で失敗。
// 200 行/チャンク + cursor 方式への分割をここで検証する。
describe("chunkRows", () => {
  it("2,050 行を 200 行ずつ分割 → 11 バッチ（最終バッチは 50 行の端数）", () => {
    const rows = Array.from({ length: 2050 }, (_, i) => i);
    const chunks = chunkRows(rows, 200);
    expect(chunks).toHaveLength(11);
    expect(chunks.slice(0, 10).every((c) => c.length === 200)).toBe(true);
    expect(chunks[10]).toHaveLength(50);
  });

  it("既定値は 200 行/チャンク", () => {
    expect(ITEM_SYNC_CHUNK_SIZE).toBe(200);
  });

  it("空配列は空配列を返す", () => {
    expect(chunkRows([], 200)).toEqual([]);
  });
});

function rowsWithIds(ids: number[]) {
  return ids.map((id) => ({ patternId: id }));
}

describe("planItemBatches", () => {
  it("既定値(chunkSize=200, batchLimit=5)で 4,422 件を計画する（2026-09-20 実測件数）", () => {
    const rows = rowsWithIds(Array.from({ length: 4422 }, (_, i) => i + 1));
    const plan = planItemBatches(rows);
    expect(ITEM_SYNC_BATCH_LIMIT).toBe(5);
    expect(plan.totalPatterns).toBe(4422);
    expect(plan.totalChunks).toBe(Math.ceil(4422 / 200)); // 23
    expect(plan.batch).toHaveLength(5); // batchLimit で切られる
    expect(plan.batch[0]).toHaveLength(200);
    expect(plan.nextCursor).toBe("1000"); // 5 チャンク目末尾の patternId(200*5)
  });

  it("cursor 指定でその pattern_id より後ろから再開する", () => {
    const rows = rowsWithIds(Array.from({ length: 500 }, (_, i) => i + 1));
    const plan = planItemBatches(rows, { chunkSize: 200, batchLimit: 5, cursor: "200" });
    expect(plan.batch).toHaveLength(2); // 残り 300 件 → 200+100
    expect(plan.batch[0][0].patternId).toBe(201);
    expect(plan.batch[1]).toHaveLength(100);
    expect(plan.nextCursor).toBeNull(); // 全件処理し切った
  });

  it("最後まで処理し切ったら next_cursor は null", () => {
    const rows = rowsWithIds([1, 2, 3]);
    const plan = planItemBatches(rows, { chunkSize: 200, batchLimit: 5 });
    expect(plan.batch).toHaveLength(1);
    expect(plan.nextCursor).toBeNull();
  });

  it("cursor が末尾以降なら空バッチ", () => {
    const rows = rowsWithIds([1, 2, 3]);
    const plan = planItemBatches(rows, { cursor: "3" });
    expect(plan.batch).toEqual([]);
    expect(plan.nextCursor).toBeNull();
  });

  it("patternId の並び順が入力と違っても昇順にソートしてから切る", () => {
    const rows = rowsWithIds([5, 1, 3, 2, 4]);
    const plan = planItemBatches(rows, { chunkSize: 2, batchLimit: 10 });
    expect(plan.batch.flat().map((r) => r.patternId)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("syncItemPatterns（DB モック・失敗分離）", () => {
  const PLAYITEMS_FIXTURE = Array.from({ length: 7 }, (_, i) => ({
    id: 100 + i,
    name: `item${i}`,
    play_item_pattern: [{ id: 1000 + i, name: `item${i}`, quantity: 1 }],
  }));

  let originalFetch: typeof global.fetch;
  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = vi.fn(async () => new Response(JSON.stringify(PLAYITEMS_FIXTURE), { status: 200 })) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  // chunkSize=2 で 7 パターン → 4 チャンク(2,2,2,1)。2 チャンク目だけ失敗させる
  function makeFakeDb(failRangeStart: number) {
    return {
      insert: () => ({
        values: (rows: Array<{ patternId: number }>) => ({
          onConflictDoUpdate: () => ({
            returning: async () => {
              if (rows.some((r) => r.patternId === failRangeStart)) {
                throw Object.assign(new Error(`Failed query: insert into "whowatch_item_patterns" ... values ($1..$24)`), { name: "DrizzleQueryError" });
              }
              return rows.map(() => ({ isInsert: true }));
            },
          }),
        }),
      }),
    } as unknown as Parameters<typeof syncItemPatterns>[0];
  }

  it("batchLimit=2, chunkSize=2 で 4 チャンク中 2 チャンクだけ処理し next_cursor を返す", async () => {
    const db = makeFakeDb(-1); // 失敗なし
    const r = await syncItemPatterns(db, { chunkSize: 2, batchLimit: 2 });
    expect(r.ok).toBe(true);
    expect(r.totalPatterns).toBe(7);
    expect(r.totalChunks).toBe(4);
    expect(r.chunks).toBe(2);
    expect(r.processed).toBe(4);
    expect(r.inserted).toBe(4);
    expect(r.next_cursor).toBe("1003"); // 2 チャンク目(patternId 1002,1003)の末尾
  });

  it("1 チャンクの失敗は他チャンクを止めず、failed に反映し SQL 全文は含まない", async () => {
    const db = makeFakeDb(1002); // 2 チャンク目(1002,1003)を失敗させる
    const r = await syncItemPatterns(db, { chunkSize: 2, batchLimit: 10 });
    expect(r.ok).toBe(false);
    expect(r.chunks).toBe(4);
    expect(r.failed).toBe(2); // 失敗チャンクの行数
    expect(r.inserted).toBe(5); // 残り 3 チャンク(2+2+1)は成功
    expect(r.error).not.toBeNull();
    expect(r.error).not.toContain("values ($1");
    expect(r.results.filter((x) => !x.ok)).toHaveLength(1);
    expect(r.results.find((x) => !x.ok)?.range).toBe("1002-1003");
  });

  it("cursor で続きから再開できる", async () => {
    const db = makeFakeDb(-1);
    const r = await syncItemPatterns(db, { chunkSize: 2, batchLimit: 10, cursor: "1003" });
    expect(r.processed).toBe(3); // 残り 1004,1005,1006
    expect(r.next_cursor).toBeNull();
  });
});
