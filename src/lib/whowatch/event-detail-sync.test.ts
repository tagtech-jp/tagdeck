import { describe, expect, it } from "vitest";
import { DETAIL_STALE_MS, isDetailFresh, isUsableStruct, planSyncTargets, STRUCT_RETRY_MS, SYNC_BATCH_LIMIT } from "./event-detail-sync";
import type { EventListItem } from "./events";

function item(eventKey: string, status: "open" | "pre" = "open"): EventListItem {
  return { id: eventKey.length, eventKey, bannerUrl: "", status, badgeText: null, canEntry: null, participants: null, startedAt: null, endedAt: null };
}

const LISTS = {
  open: [item("2026_10_collabo_program"), item("2026_09_vliver_cp"), item("2026_09_autumncollection"), item("2026_09_autumncollectionlite"), item("2026_09_gingiragin"), item("whowatch_dojo"), item("nice_one_ranking")],
  pre: [item("2026_09_wolfcoming", "pre"), item("2026_09_rookie_2", "pre"), item("2026_09_toryumon_2", "pre"), item("2026_09_vliver_cp", "pre") /* 重複 */],
};

describe("planSyncTargets", () => {
  it("event_key 昇順に並べ、既定 3 件ずつ cursor で続きを返す（重複は除く）", () => {
    expect(SYNC_BATCH_LIMIT).toBe(3);
    const p1 = planSyncTargets(LISTS);
    expect(p1.total).toBe(10);
    expect(p1.batch.map((e) => e.eventKey)).toEqual(["2026_09_autumncollection", "2026_09_autumncollectionlite", "2026_09_gingiragin"]);
    expect(p1.nextCursor).toBe("2026_09_gingiragin");

    const p2 = planSyncTargets(LISTS, { cursor: p1.nextCursor });
    expect(p2.batch.map((e) => e.eventKey)).toEqual(["2026_09_rookie_2", "2026_09_toryumon_2", "2026_09_vliver_cp"]);

    const p3 = planSyncTargets(LISTS, { cursor: p2.nextCursor });
    expect(p3.batch.map((e) => e.eventKey)).toEqual(["2026_09_wolfcoming", "2026_10_collabo_program", "nice_one_ranking"]);

    const p4 = planSyncTargets(LISTS, { cursor: p3.nextCursor });
    expect(p4.batch.map((e) => e.eventKey)).toEqual(["whowatch_dojo"]);
    expect(p4.nextCursor).toBeNull();
  });

  it("cursor が末尾以降なら空、limit は 1〜10 に丸める", () => {
    expect(planSyncTargets(LISTS, { cursor: "zzz" }).batch).toEqual([]);
    expect(planSyncTargets(LISTS, { limit: 100 }).batch).toHaveLength(10);
    expect(planSyncTargets(LISTS, { limit: 0 }).batch).toHaveLength(1);
  });

  it("event_key 指定なら 1 件だけ（一覧に無くても試みる）", () => {
    const p = planSyncTargets(LISTS, { eventKey: "2026_09_autumncollection" });
    expect(p.batch.map((e) => e.eventKey)).toEqual(["2026_09_autumncollection"]);
    expect(p.nextCursor).toBeNull();
    const q = planSyncTargets(LISTS, { eventKey: "closed_event" });
    expect(q.batch[0].eventKey).toBe("closed_event");
    expect(q.batch[0].id).toBe(-1);
  });
});

describe("isDetailFresh / isUsableStruct（区分の構造の取り直し・2026-10-01）", () => {
  // 2026_10_magicfantasy: 日次同期で取得時刻だけ保存され、struct の保存が Network connection lost で失敗した時刻
  const fetchedAt = new Date("2026-09-30T19:46:41.000Z");
  const after = (min: number) => fetchedAt.getTime() + min * 60 * 1000;

  it("構造が保存済みなら 24 時間は DB のまま", () => {
    const row = { detailFetchedAt: fetchedAt, rankingPrefix: "magicfantasy", struct: { options: [] } };
    expect(isDetailFresh(row, after(11))).toBe(true);
    expect(isDetailFresh(row, after(DETAIL_STALE_MS / 60000 - 1))).toBe(true);
    expect(isDetailFresh(row, after(DETAIL_STALE_MS / 60000))).toBe(false);
  });

  it("RANKING タブがあるのに構造が無い（保存失敗・未公開）なら 10 分で取り直す", () => {
    expect(STRUCT_RETRY_MS).toBe(10 * 60 * 1000);
    const row = { detailFetchedAt: fetchedAt, rankingPrefix: "magicfantasy", struct: null };
    expect(isDetailFresh(row, after(9))).toBe(true);
    expect(isDetailFresh(row, after(10))).toBe(false);
    // 修正前に保存された未公開時の応答も「構造なし」
    expect(isDetailFresh({ ...row, struct: { error_code: "Z-002", error_message: "データが見つかりません" } }, after(10))).toBe(false);
  });

  it("RANKING タブが無い（prefix が空文字）なら構造が無くても 24 時間", () => {
    expect(isDetailFresh({ detailFetchedAt: fetchedAt, rankingPrefix: "", struct: null }, after(60))).toBe(true);
  });

  it("未取得（取得時刻なし・prefix null）は取り直す。maxAgeMs が短ければそちらが優先", () => {
    expect(isDetailFresh(null, after(0))).toBe(false);
    expect(isDetailFresh({ detailFetchedAt: null, rankingPrefix: "x", struct: {} }, after(0))).toBe(false);
    expect(isDetailFresh({ detailFetchedAt: fetchedAt, rankingPrefix: null, struct: null }, after(0))).toBe(false);
    expect(isDetailFresh({ detailFetchedAt: fetchedAt, rankingPrefix: "x", struct: null }, after(3), 2 * 60 * 1000)).toBe(false);
  });

  it("isUsableStruct: オブジェクトで error_code が無いものだけ", () => {
    expect(isUsableStruct({ options: [] })).toBe(true);
    expect(isUsableStruct({})).toBe(true);
    expect(isUsableStruct(null)).toBe(false);
    expect(isUsableStruct([])).toBe(false);
    expect(isUsableStruct("x")).toBe(false);
    expect(isUsableStruct({ error_code: "Z-002" })).toBe(false);
  });
});
