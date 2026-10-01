import { beforeEach, describe, expect, it, vi } from "vitest";
import { DB_LARGE_COLUMN_MAX_BYTES } from "./sanitize";

// syncEventDetail の「構造が欠けた行の取り直し」と「大きい列の保存」（2026-10-01・2026_10_magicfantasy の実害）
const { STRUCT, getEventDetailMock, getRulesMock } = vi.hoisted(() => ({
  STRUCT: { name: "ふわっちマジックファンタジーワールド", options: [{ key: "1st", value: "前半", selectboxes: [{ key: "overall", value: "前半総合" }] }] },
  getEventDetailMock: vi.fn(),
  getRulesMock: vi.fn(),
}));
vi.mock("./events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./events")>();
  return {
    ...actual,
    getEventDetail: getEventDetailMock,
    getEventLists: vi.fn(async () => ({
      open: [
        {
          id: 1523,
          eventKey: "2026_10_magicfantasy",
          bannerUrl: "",
          status: "open",
          badgeText: null,
          canEntry: null,
          participants: null,
          startedAt: Date.parse("2026-09-30T15:00:00.000Z"),
          endedAt: Date.parse("2026-10-12T14:59:59.000Z"),
        },
      ],
      pre: [],
      closed: [],
    })),
    getRankingStruct: vi.fn(async () => STRUCT),
    getRules: getRulesMock,
  };
});

import { syncEventDetail } from "./event-detail-sync";

type Row = Record<string, unknown>;

function storedRow(minutesAgo: number): Row {
  return {
    id: 1523,
    eventKey: "2026_10_magicfantasy",
    name: "ふわっちマジックファンタジーワールド",
    titleJa: null,
    shortName: "マジックファンタジー",
    status: "open",
    startedAt: new Date("2026-09-30T15:00:00.000Z"),
    endedAt: new Date("2026-10-12T14:59:59.000Z"),
    kind: "long",
    rankingPrefix: "magicfantasy",
    struct: null,
    rulesText: null,
    rulesHtml: null,
    rulesParsed: null,
    periods: null,
    bannerUrl: "",
    badgeText: null,
    participants: null,
    lastSyncedAt: new Date("2026-09-30T19:46:41.000Z"),
    detailFetchedAt: new Date(Date.now() - minutesAgo * 60 * 1000),
  };
}

/** UPDATE の結果を順に返す DB（"ok" か投げる Error） */
function fakeDb(row: Row | null, updateResults: Array<"ok" | Error>) {
  const updateSets: Row[] = [];
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (row ? [row] : []) }) }) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: async () => undefined }) }),
    update: () => ({
      set: (v: Row) => ({
        where: async () => {
          updateSets.push(v);
          const r = updateResults.shift() ?? "ok";
          if (r instanceof Error) throw r;
        },
      }),
    }),
  };
  return { db: db as unknown as Parameters<typeof syncEventDetail>[0], updateSets };
}

const keysOf = (sets: Row[]) => sets.map((s) => Object.keys(s).sort().join(","));
const bytes = (v: unknown) => Buffer.byteLength(String(v), "utf8");

describe("syncEventDetail（構造の取り直し・大きい列の保存）", () => {
  beforeEach(() => {
    getEventDetailMock.mockReset();
    getRulesMock.mockReset();
    getEventDetailMock.mockImplementation(async (eventKey: string) => ({
      eventKey,
      name: "ふわっちマジックファンタジーワールド",
      shortName: "マジックファンタジー",
      tabs: [],
      rankingPrefix: "magicfantasy",
      itemGroupKey: "magicfantasy",
      notificationIds: [],
    }));
  });

  it("構造が欠けた行は 10 分で取り直し、struct を単独で保存する（一時的な切断は 1 回やり直す）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db, updateSets } = fakeDb(storedRow(11), [new Error("Failed query ← Network connection lost."), "ok", "ok", "ok"]);
    const v = await syncEventDetail(db, "2026_10_magicfantasy");
    expect(getEventDetailMock).toHaveBeenCalledTimes(1);
    expect(v.source).toBe("api");
    expect(v.struct).toEqual(STRUCT);
    expect(v.note ?? "").not.toContain("保存に失敗");
    // struct（失敗 → やり直し）→ rules_text → rules_html の順に 1 列ずつ
    expect(keysOf(updateSets)).toEqual(["struct", "struct", "rulesText", "rulesHtml"]);
    expect(updateSets[1].struct).toEqual(STRUCT);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("struct のやり直しも失敗したら警告を返すが、取り直した構造は返す（5 分同期はそれで区分を決められる）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lost = new Error("Network connection lost.");
    const { db, updateSets } = fakeDb(storedRow(11), [lost, lost, "ok", "ok"]);
    const v = await syncEventDetail(db, "2026_10_magicfantasy");
    expect(v.struct).toEqual(STRUCT);
    expect(v.note).toContain("struct の保存に失敗");
    // struct が失敗しても本文の保存は続ける
    expect(keysOf(updateSets)).toEqual(["struct", "struct", "rulesText", "rulesHtml"]);
    warn.mockRestore();
  });

  it("本文の保存が失敗しても struct は保存される（同じ UPDATE に入れない）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lost = new Error("Network connection lost.");
    const { db, updateSets } = fakeDb(storedRow(11), ["ok", lost, lost, "ok"]);
    const v = await syncEventDetail(db, "2026_10_magicfantasy");
    expect(keysOf(updateSets)[0]).toBe("struct");
    expect(updateSets[0].struct).toEqual(STRUCT);
    expect(v.note).toContain("rules_text の保存に失敗");
    expect(v.note).not.toContain("struct の保存に失敗");
    warn.mockRestore();
  });

  it("長い本文・HTML は保存できる大きさに切り詰める（返す本文は切らない）", async () => {
    getEventDetailMock.mockImplementation(async (eventKey: string) => ({
      eventKey,
      name: "ふわっちマジックファンタジーワールド",
      shortName: "マジックファンタジー",
      tabs: [],
      rankingPrefix: "magicfantasy",
      itemGroupKey: "magicfantasy",
      notificationIds: ["2341454"],
    }));
    const longText = "賞品と順位の説明。".repeat(5000); // 約 13.5 万バイト
    getRulesMock.mockResolvedValue({ id: "2341454", title: "概要", html: `<p>${longText}</p>`, text: longText });
    const { db, updateSets } = fakeDb(storedRow(11), []);
    const v = await syncEventDetail(db, "2026_10_magicfantasy");
    const text = updateSets.find((s) => "rulesText" in s)?.rulesText;
    const html = updateSets.find((s) => "rulesHtml" in s)?.rulesHtml;
    expect(bytes(text)).toBeLessThanOrEqual(DB_LARGE_COLUMN_MAX_BYTES);
    expect(String(text)).toContain("長いため以降を省略");
    expect(bytes(html)).toBeLessThanOrEqual(DB_LARGE_COLUMN_MAX_BYTES + 32);
    expect(bytes(v.rulesText)).toBeGreaterThan(DB_LARGE_COLUMN_MAX_BYTES);
    expect(v.note ?? "").not.toContain("保存に失敗");
  });

  it("10 分以内に取り直したばかりなら API を叩かず DB のまま返す", async () => {
    const { db } = fakeDb(storedRow(5), []);
    const v = await syncEventDetail(db, "2026_10_magicfantasy");
    expect(getEventDetailMock).not.toHaveBeenCalled();
    expect(v.source).toBe("db");
  });
});
