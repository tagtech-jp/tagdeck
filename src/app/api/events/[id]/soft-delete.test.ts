import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { getTableColumns, getTableName, type SQL } from "drizzle-orm";
import { PgDialect, type PgTable } from "drizzle-orm/pg-core";

// シミュレーターの論理削除（2026-09-30）: 削除済み（status='deleted'）は一覧からも id 指定の各ルートからも
// 見えない（404）こと、削除後もランキング履歴（ranking_snapshots）が残ることを、実際の行に対して確かめる。

type Row = Record<string, unknown>;
type Fields = Record<string, unknown>;

const h = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  db: null as unknown,
  sync: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
}));
vi.mock("@/lib/db/client", () => ({ createDbClient: () => h.db }));
// 公開 API を叩く同期処理はモック（ここで確かめたいのは「削除済みなら呼ばれない」こと）
vi.mock("@/lib/whowatch/ranking-sync", () => ({
  syncSimulatorRanking: (...args: unknown[]) => h.sync(...args),
}));

import { DELETE, PATCH } from "./route";
import { GET as listEvents } from "../route";
import { POST as complete } from "./complete/route";
import { GET as historicalPace } from "./historical-pace/route";
import { POST as manualRivals } from "./manual-rivals/route";
import { POST as refreshRanking } from "./refresh-ranking/route";
import { GET as snapshots } from "./snapshots/route";
import { POST as estimateItemPoint } from "@/app/api/platforms/whowatch/events/[event_key]/item-points/estimate/route";
import { eventHistory, eventSimulators, rankingSnapshots } from "@/lib/db/schema";

// ── インメモリ DB ──────────────────────────────────────────────
// ルートが組み立てた Drizzle の WHERE / ORDER BY を PgDialect で SQL に描画して評価する。
// 対応するのは「"表"."列" = $n / <> $n を and でつないだ形」と「"表"."列" asc|desc」だけ。
// それ以外の形は例外にして、条件を読み飛ばしたままテストが通ることを防ぐ。
const dialect = new PgDialect();

/** DB 列名 → TS のプロパティ名 */
function columnKeys(table: PgTable): Record<string, string> {
  return Object.fromEntries(Object.entries(getTableColumns(table)).map(([key, col]) => [col.name, key]));
}

function compileWhere(table: PgTable, cond: SQL | undefined): (row: Row) => boolean {
  if (!cond) throw new Error("fake db: WHERE なしのクエリは想定していない");
  const { sql, params } = dialect.sqlToQuery(cond);
  const keys = columnKeys(table);
  const body = sql.startsWith("(") && sql.endsWith(")") ? sql.slice(1, -1) : sql;
  const preds = body.split(" and ").map((part) => {
    const m = /^"(\w+)"\."(\w+)" (=|<>) \$(\d+)$/.exec(part);
    if (!m || m[1] !== getTableName(table) || !(m[2] in keys)) throw new Error(`fake db: 未対応の WHERE 句: ${sql}`);
    const key = keys[m[2]];
    const value = params[Number(m[4]) - 1];
    return m[3] === "=" ? (row: Row) => row[key] === value : (row: Row) => row[key] !== value;
  });
  return (row) => preds.every((p) => p(row));
}

function compileOrder(table: PgTable, order: SQL): (a: Row, b: Row) => number {
  const { sql } = dialect.sqlToQuery(order);
  const m = /^"(\w+)"\."(\w+)" (asc|desc)$/.exec(sql);
  const keys = columnKeys(table);
  if (!m || m[1] !== getTableName(table) || !(m[2] in keys)) throw new Error(`fake db: 未対応の ORDER BY: ${sql}`);
  const key = keys[m[2]];
  const dir = m[3] === "desc" ? -1 : 1;
  const val = (v: unknown) => (v instanceof Date ? v.getTime() : (v as number));
  return (a, b) => (val(a[key]) - val(b[key])) * dir;
}

function project(table: PgTable, row: Row, fields?: Fields): Row {
  if (!fields) return { ...row };
  const keys = columnKeys(table);
  return Object.fromEntries(
    Object.entries(fields).map(([alias, col]) => {
      const name = (col as { name?: unknown }).name;
      if (typeof name !== "string" || !(name in keys)) throw new Error(`fake db: 未対応の select 列: ${alias}`);
      return [alias, row[keys[name]]];
    }),
  );
}

/** await されたときに実行する（Drizzle のクエリビルダーと同じく、組み立てと実行を分ける） */
abstract class TableQuery<T> {
  protected readonly db: FakeDb;
  protected readonly table: PgTable;
  protected cond: ((row: Row) => boolean) | null = null;
  protected returnFields: { fields?: Fields } | null = null;

  constructor(db: FakeDb, table: PgTable) {
    this.db = db;
    this.table = table;
  }

  protected abstract run(): T;

  then<A = T, B = never>(
    ok?: ((value: T) => A | PromiseLike<A>) | null,
    ng?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return Promise.resolve()
      .then(() => this.run())
      .then(ok, ng);
  }

  where(cond: SQL | undefined): this {
    this.cond = compileWhere(this.table, cond);
    return this;
  }

  returning(fields?: Fields): this {
    this.returnFields = { fields };
    return this;
  }

  protected hits(kind: string): Row[] {
    if (!this.cond) throw new Error(`fake db: WHERE なしの ${kind} は想定していない`);
    return this.db.rows(this.table).filter(this.cond);
  }

  protected returned(rows: Row[]): Row[] | undefined {
    const r = this.returnFields;
    return r ? rows.map((row) => project(this.table, row, r.fields)) : undefined;
  }
}

class SelectQuery extends TableQuery<Row[]> {
  private readonly fields?: Fields;
  private order: ((a: Row, b: Row) => number) | null = null;
  private max = Infinity;

  constructor(db: FakeDb, table: PgTable, fields?: Fields) {
    super(db, table);
    this.fields = fields;
  }

  orderBy(order: SQL): this {
    this.order = compileOrder(this.table, order);
    return this;
  }

  limit(n: number): this {
    this.max = n;
    return this;
  }

  protected run(): Row[] {
    const hit = this.hits("SELECT");
    if (this.order) hit.sort(this.order);
    return hit.slice(0, this.max).map((row) => project(this.table, row, this.fields));
  }
}

class UpdateQuery extends TableQuery<Row[] | undefined> {
  private values: Row = {};

  set(values: Row): this {
    this.values = values;
    return this;
  }

  protected run(): Row[] | undefined {
    const hit = this.hits("UPDATE");
    for (const row of hit) Object.assign(row, this.values);
    return this.returned(hit);
  }
}

class InsertQuery extends TableQuery<Row[] | undefined> {
  private row: Row = {};
  private ignoreConflict = false;

  values(values: Row): this {
    this.row = { id: randomUUID(), ...values };
    return this;
  }

  onConflictDoNothing(): this {
    this.ignoreConflict = true;
    return this;
  }

  protected run(): Row[] | undefined {
    const rows = this.db.rows(this.table);
    if (this.ignoreConflict && rows.some((r) => r.id === this.row.id)) return this.returned([]);
    rows.push(this.row);
    return this.returned([this.row]);
  }
}

/** 物理削除。本番と同じく event_simulators を消すと ranking_snapshots も連鎖で消える（ON DELETE cascade） */
class DeleteQuery extends TableQuery<Row[] | undefined> {
  protected run(): Row[] | undefined {
    const hit = this.hits("DELETE");
    this.db.remove(this.table, hit);
    return this.returned(hit);
  }
}

class FakeDb {
  private readonly tables = new Map<PgTable, Row[]>();
  deleteCalls = 0;

  rows(table: PgTable): Row[] {
    let rows = this.tables.get(table);
    if (!rows) this.tables.set(table, (rows = []));
    return rows;
  }

  select(fields?: Fields) {
    return { from: (table: PgTable) => new SelectQuery(this, table, fields) };
  }

  update(table: PgTable) {
    return new UpdateQuery(this, table);
  }

  insert(table: PgTable) {
    return new InsertQuery(this, table);
  }

  delete(table: PgTable) {
    this.deleteCalls++;
    return new DeleteQuery(this, table);
  }

  remove(table: PgTable, hit: Row[]) {
    this.tables.set(table, this.rows(table).filter((r) => !hit.includes(r)));
    if (table === eventSimulators) {
      const ids = new Set(hit.map((r) => r.id));
      this.tables.set(rankingSnapshots, this.rows(rankingSnapshots).filter((s) => !ids.has(s.simulatorId)));
    }
  }

  async transaction<T>(fn: (tx: FakeDb) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

// ── テストデータ ────────────────────────────────────────────────
const ME = "user-1";
const OTHER = "user-2";
const SIM_ACTIVE = "11111111-1111-4111-8111-111111111111";
const SIM_DELETED = "22222222-2222-4222-8222-222222222222";
const SIM_COMPLETED = "33333333-3333-4333-8333-333333333333";
const SIM_OTHERS = "44444444-4444-4444-8444-444444444444";
const OLD = new Date("2026-09-25T06:00:00Z");

function simulator(id: string, overrides: Row = {}): Row {
  return {
    id,
    userId: ME,
    name: `シミュレーター ${id.slice(0, 4)}`,
    platform: "whowatch",
    eventType: "ranking",
    targetScore: null,
    targetRank: 3,
    eventRankingUrl: null,
    myEntryName: null,
    whowatchEventId: null,
    rankingType: "autumncollection_1st_overall",
    startTime: new Date("2026-09-25T06:00:00Z"),
    endTime: new Date("2026-09-30T06:00:00Z"),
    status: "active",
    currentScore: 1200,
    currentRank: 5,
    manualScore: null,
    paceHistory: [],
    rivalsSnapshot: null,
    rivalsHistory: [],
    manualRivals: [],
    lastSimulation: null,
    createdAt: OLD,
    updatedAt: OLD,
    ...overrides,
  };
}

function snapshot(simulatorId: string, capturedAt: string, myPoint: number): Row {
  return {
    id: randomUUID(),
    simulatorId,
    rankingType: "autumncollection_1st_overall",
    capturedAt: new Date(capturedAt),
    status: 1,
    entries: [],
    myRank: 5,
    myPoint,
  };
}

let db: FakeDb;

beforeEach(() => {
  h.user = { id: ME };
  h.sync.mockReset();
  h.sync.mockResolvedValue({
    source: "api",
    myEntry: { rank: 5, name: "自分", score: 1200 },
    rivals: [],
    snapshotId: "snap-new",
    status: 1,
  });
  db = new FakeDb();
  h.db = db;
  db.rows(eventSimulators).push(
    simulator(SIM_ACTIVE),
    simulator(SIM_DELETED, { status: "deleted" }),
    simulator(SIM_COMPLETED, { status: "completed" }),
    simulator(SIM_OTHERS, { userId: OTHER }),
  );
  db.rows(rankingSnapshots).push(
    snapshot(SIM_ACTIVE, "2026-09-25T06:05:00Z", 100),
    snapshot(SIM_ACTIVE, "2026-09-25T06:10:00Z", 180),
    snapshot(SIM_DELETED, "2026-09-23T06:00:00Z", 50),
    snapshot(SIM_COMPLETED, "2026-09-24T00:00:00Z", 70),
  );
});

const BASE = "https://tagdeck.jp/api/events";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const deleteSim = (id: string) => DELETE(new Request(`${BASE}/${id}`, { method: "DELETE" }), ctx(id));
const simRow = (id: string) => db.rows(eventSimulators).find((r) => r.id === id);

// DELETE 単体（更新する値・WHERE 条件・401/404）は route.test.ts で確認済み。
// ここでは実際の行に対して、削除後も履歴が残り、画面からは見えなくなる流れを確かめる
describe("DELETE /api/events/[id] の後（論理削除）", () => {
  it("行と ranking_snapshots は残り、一覧にも id 指定の読み込みにも出てこない", async () => {
    const res = await deleteSim(SIM_ACTIVE);

    expect(res.status).toBe(200);
    expect(db.deleteCalls).toBe(0);
    expect(simRow(SIM_ACTIVE)).toMatchObject({ status: "deleted", currentScore: 1200 });
    // 物理削除だと ON DELETE cascade で消えていた履歴（E3 の検証データ）が残る
    expect(db.rows(rankingSnapshots).filter((s) => s.simulatorId === SIM_ACTIVE)).toHaveLength(2);

    const list = (await (await listEvents()).json()) as { events: Row[] };
    expect(list.events.map((e) => e.id)).not.toContain(SIM_ACTIVE);
    const snaps = await snapshots(new Request(`${BASE}/${SIM_ACTIVE}/snapshots`), ctx(SIM_ACTIVE));
    expect(snaps.status).toBe(404);
  });

  it("削除済みをもう一度 DELETE すると 404 で、updated_at は動かさない", async () => {
    const res = await deleteSim(SIM_DELETED);

    expect(res.status).toBe(404);
    expect(simRow(SIM_DELETED)).toMatchObject({ status: "deleted", updatedAt: OLD });
  });
});

describe("GET /api/events（一覧）", () => {
  it("status='active' だけを返す（削除済み・完了済み・他人の分は出ない）", async () => {
    const res = await listEvents();

    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Row[] };
    expect(body.events.map((e) => e.id)).toEqual([SIM_ACTIVE]);
  });
});

// シミュレーターを id で読むルート（src/app/api/events/[id]/** と item-points/estimate）
const ID_ROUTES: Array<{ name: string; call: (id: string) => Promise<Response> }> = [
  {
    name: "PATCH /api/events/[id]（スコア入力）",
    call: (id) => PATCH(new Request(`${BASE}/${id}`, jsonInit("PATCH", { score: 500 })), ctx(id)),
  },
  {
    name: "PATCH /api/events/[id]（設定編集）",
    call: (id) => PATCH(new Request(`${BASE}/${id}`, jsonInit("PATCH", { name: "改名後" })), ctx(id)),
  },
  {
    name: "POST /api/events/[id]/complete",
    call: (id) => complete(new Request(`${BASE}/${id}/complete`, jsonInit("POST", { achieved: true, finalRank: 3 })), ctx(id)),
  },
  {
    name: "GET /api/events/[id]/historical-pace",
    call: (id) => historicalPace(new Request(`${BASE}/${id}/historical-pace?eventType=ranking`), ctx(id)),
  },
  {
    name: "POST /api/events/[id]/manual-rivals",
    call: (id) =>
      manualRivals(new Request(`${BASE}/${id}/manual-rivals`, jsonInit("POST", { rivals: [{ name: "ライバル", score: 10 }] })), ctx(id)),
  },
  {
    name: "POST /api/events/[id]/refresh-ranking",
    call: (id) => refreshRanking(new Request(`${BASE}/${id}/refresh-ranking`, { method: "POST" }), ctx(id)),
  },
  {
    name: "GET /api/events/[id]/snapshots",
    call: (id) => snapshots(new Request(`${BASE}/${id}/snapshots?limit=10`), ctx(id)),
  },
  {
    name: "POST /api/platforms/whowatch/events/[event_key]/item-points/estimate",
    call: (id) =>
      estimateItemPoint(
        new Request(
          "https://tagdeck.jp/api/platforms/whowatch/events/autumncollection/item-points/estimate",
          jsonInit("POST", { simulatorId: id, itemId: "1" }),
        ),
        { params: Promise.resolve({ event_key: "autumncollection" }) },
      ),
  },
];

describe("削除済みシミュレーターは id で読んでも見つからない扱い（404）", () => {
  it.each(ID_ROUTES)("$name: 削除済み → 404。行・完了履歴は変わらず、公開 API も叩かない", async ({ call }) => {
    const before = structuredClone(db.rows(eventSimulators));

    const res = await call(SIM_DELETED);

    expect(res.status).toBe(404);
    expect(db.rows(eventSimulators)).toEqual(before);
    expect(db.rows(eventHistory)).toHaveLength(0);
    expect(h.sync).not.toHaveBeenCalled();
  });

  it.each(ID_ROUTES)("$name: 開催中（active）は従来どおり 200", async ({ call }) => {
    expect((await call(SIM_ACTIVE)).status).toBe(200);
  });

  it.each(ID_ROUTES)("$name: 完了済み（completed）も従来どおり 200（status の扱いは変えない）", async ({ call }) => {
    expect((await call(SIM_COMPLETED)).status).toBe(200);
  });

  it.each(ID_ROUTES)("$name: 他人のシミュレーターは 404", async ({ call }) => {
    expect((await call(SIM_OTHERS)).status).toBe(404);
  });
});
