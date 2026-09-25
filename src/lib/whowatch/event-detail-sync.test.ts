import { describe, expect, it } from "vitest";
import { planSyncTargets, SYNC_BATCH_LIMIT } from "./event-detail-sync";
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
