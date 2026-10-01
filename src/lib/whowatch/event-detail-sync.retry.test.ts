import { beforeEach, describe, expect, it, vi } from "vitest";

// syncEventDetail の「構造が欠けた行の取り直し」と「大きい列の保存のやり直し」（2026-10-01・2026_10_magicfantasy の実害）
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

import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { DB_WRITE_CHUNK_BYTES, EventDetailSyncError, syncEventDetail } from "./event-detail-sync";

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

/** UPDATE の結果を順に返す DB（"ok" か投げる Error）。トランザクションの中の UPDATE は tx: true を付けて残す */
function fakeDb(row: Row | null, updateResults: Array<"ok" | Error>) {
  const updateSets: Row[] = [];
  const update = (tx: boolean) => () => ({
    set: (v: Row) => ({
      where: async () => {
        updateSets.push(tx ? { ...v, tx: true } : v);
        const r = updateResults.shift() ?? "ok";
        if (r instanceof Error) throw r;
      },
    }),
  });
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (row ? [row] : []) }) }) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: async () => undefined }) }),
    update: update(false),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({ update: update(true) }),
  };
  return { db: db as unknown as Parameters<typeof syncEventDetail>[0], updateSets };
}

const keysOf = (sets: Row[]) => sets.map((s) => Object.keys(s).filter((k) => k !== "tx").sort().join(","));

describe("syncEventDetail（構造の取り直し・保存のやり直し）", () => {
  beforeEach(() => {
    getRulesMock.mockReset();
    getEventDetailMock.mockReset();
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

  it("構造が欠けた行は 10 分で取り直し、一時的な切断で失敗した struct の保存を 1 回やり直す", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db, updateSets } = fakeDb(storedRow(11), [new Error("Failed query ← Network connection lost."), "ok", "ok"]);
    const v = await syncEventDetail(db, "2026_10_magicfantasy");
    expect(getEventDetailMock).toHaveBeenCalledTimes(1);
    expect(v.source).toBe("api");
    expect(v.struct).toEqual(STRUCT);
    expect(v.note ?? "").not.toContain("保存に失敗");
    // struct を単独で先に（失敗 → やり直し）、続けて rules_text・rules_html
    expect(keysOf(updateSets)).toEqual(["struct", "struct", "rulesText", "rulesHtml"]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("やり直しも失敗したら警告を返すが、取り直した構造は返す（5 分同期はそれで区分を決められる）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lost = new Error("Network connection lost.");
    const { db, updateSets } = fakeDb(storedRow(11), [lost, lost]);
    const v = await syncEventDetail(db, "2026_10_magicfantasy");
    expect(v.struct).toEqual(STRUCT);
    expect(v.note).toContain("struct の保存に失敗");
    // 本文の保存は struct の失敗に巻き込まれない
    expect(keysOf(updateSets)).toEqual(["struct", "struct", "rulesText", "rulesHtml"]);
    warn.mockRestore();
  });

  it("64KB を超えるルール本文（マジックファンタジーは 72,594 バイト）は 16KB ずつ 1 つのトランザクションで書き、つなげると元の本文になる", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getEventDetailMock.mockImplementation(async (eventKey: string) => ({
      eventKey,
      name: "ふわっちマジックファンタジーワールド",
      shortName: "マジックファンタジー",
      tabs: [],
      rankingPrefix: "magicfantasy",
      itemGroupKey: "magicfantasy",
      notificationIds: ["2341454"],
    }));
    const body = "マジックファンタジー🎩".repeat(2500); // 約 82KB（UTF-8）。4 バイト文字を含めて文字の途中で切らないことも確かめる
    getRulesMock.mockResolvedValue({ id: "2341454", title: "概要", html: `<p>${body}</p>`, text: body, eventKey: null, publishedAt: null });
    const { db, updateSets } = fakeDb(storedRow(11), []);
    const v = await syncEventDetail(db, "2026_10_magicfantasy");
    expect(v.note ?? "").not.toContain("保存に失敗");
    expect(keysOf(updateSets)[0]).toBe("struct");

    const dialect = new PgDialect();
    for (const column of ["rulesText", "rulesHtml"] as const) {
      const writes = updateSets.filter((s) => column in s);
      expect(writes.length).toBeGreaterThan(4);
      expect(writes.every((w) => w.tx === true)).toBe(true);
      // 1 つ目で置き換え、2 つ目からは後ろに足す
      const first = writes[0][column] as string;
      const rest = writes.slice(1).map((w) => dialect.sqlToQuery(w[column] as SQL));
      for (const q of rest) {
        expect(q.sql).toMatch(/^coalesce\(.*"rules_(text|html)", ''\) \|\| \$1$/);
        expect(q.params).toHaveLength(1);
      }
      const chunks = [first, ...rest.map((q) => q.params[0] as string)];
      for (const c of chunks) expect(Buffer.byteLength(c, "utf8")).toBeLessThanOrEqual(DB_WRITE_CHUNK_BYTES);
      expect(chunks.join("")).toBe(column === "rulesText" ? v.rulesText : `<p>${body}</p>`);
    }
    warn.mockRestore();
  });

  it("先頭の読み込みが失敗したら EventDetailSyncError（db）。message に SQL 全文・params を含めない", async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              throw new Error('Failed query: select "id", "event_key" from "whowatch_events" where "event_key" = $1 limit $2\nparams: 2026_10_magicfantasy,1');
            },
          }),
        }),
      }),
    } as unknown as Parameters<typeof syncEventDetail>[0];
    const err = await syncEventDetail(db, "2026_10_magicfantasy").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EventDetailSyncError);
    expect((err as EventDetailSyncError).stage).toBe("db");
    expect((err as Error).message).toContain("Failed query");
    expect((err as Error).message).not.toContain("select");
    expect((err as Error).message).not.toContain("params");
    expect(getEventDetailMock).not.toHaveBeenCalled();
  });

  it("10 分以内に取り直したばかりなら API を叩かず DB のまま返す", async () => {
    const { db } = fakeDb(storedRow(5), []);
    const v = await syncEventDetail(db, "2026_10_magicfantasy");
    expect(getEventDetailMock).not.toHaveBeenCalled();
    expect(v.source).toBe("db");
  });
});
