import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { randomUUID } from "node:crypto";
import { getTableColumns, getTableName, SQL } from "drizzle-orm";
import { PgDialect, type PgTable } from "drizzle-orm/pg-core";
import type { LiveComment, LiveResponse } from "@/lib/whowatch/live-feed";

// リスナーの累計（listeners.total_gift_amount / total_comment_count）の加算（2026-10-02）。
// 同じギフトを 2 回処理しても累計は 1 回分しか増えないこと、同時に走った加算を取りこぼさないことを、
// 実際の行に対して確かめる。対象は POST /api/platforms/whowatch/live/poll（ctx.waitUntil の中の保存）と、
// 同じ型の処理を持つ POST /api/platforms/kick/event

type Row = Record<string, unknown>;
type Fields = Record<string, unknown>;

const h = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  db: null as unknown,
  fetchLive: vi.fn<(liveId: string, lastUpdatedAt?: number | string) => Promise<LiveResponse>>(),
  background: [] as Array<Promise<unknown>>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
}));
vi.mock("@/lib/db/client", () => ({ createDbClient: () => h.db }));
// 本番では応答を返したあとに走る保存処理。テストでは捕まえておき、poll のたびに完了まで待つ
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({ ctx: { waitUntil: (p: Promise<unknown>) => void h.background.push(p) } }),
}));
vi.mock("@/lib/whowatch/live-feed", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/whowatch/live-feed")>()),
  fetchLive: (liveId: string, lastUpdatedAt?: number | string) => h.fetchLive(liveId, lastUpdatedAt),
}));

import { POST as livePoll } from "./whowatch/live/poll/route";
import { POST as kickEvent } from "./kick/event/route";
import { events, listeners, streamerProfiles } from "@/lib/db/schema";

// ── インメモリ DB ──────────────────────────────────────────────
// ルートが組み立てた Drizzle の WHERE / SET を PgDialect で SQL に描画して評価する（soft-delete.test.ts と同じ作り）。
// 解釈できる形だけを受け付け、それ以外は例外にして、条件や加算式を読み飛ばしたままテストが通ることを防ぐ。
const dialect = new PgDialect();

/** DB 列名 → TS のプロパティ名 */
function columnKeys(table: PgTable): Record<string, string> {
  return Object.fromEntries(Object.entries(getTableColumns(table)).map(([key, col]) => [col.name, key]));
}

/** 「"表"."列" = $n」を and でつないだ WHERE だけ対応 */
function compileWhere(table: PgTable, cond: SQL | undefined): (row: Row) => boolean {
  if (!cond) throw new Error("fake db: WHERE なしのクエリは想定していない");
  const { sql, params } = dialect.sqlToQuery(cond);
  const keys = columnKeys(table);
  const body = sql.startsWith("(") && sql.endsWith(")") ? sql.slice(1, -1) : sql;
  const preds = body.split(" and ").map((part) => {
    const m = /^"(\w+)"\."(\w+)" = \$(\d+)$/.exec(part);
    if (!m || m[1] !== getTableName(table) || !(m[2] in keys)) throw new Error(`fake db: 未対応の WHERE 句: ${sql}`);
    const key = keys[m[2]];
    const value = params[Number(m[3]) - 1];
    return (row: Row) => row[key] === value;
  });
  return (row) => preds.every((p) => p(row));
}

/**
 * UPDATE の SET を行へ当てる。SQL 式は「coalesce("表"."その列", 0) + 数」だけ対応し、実行した時点の行の値に足す
 * （＝ DB の中で足すのと同じ）。JS で計算した数値（読んでから足す形）は、ふつうの値としてそのまま上書きになる
 */
function applySet(table: PgTable, row: Row, values: Row): void {
  const keys = columnKeys(table);
  for (const [key, value] of Object.entries(values)) {
    if (!(value instanceof SQL)) {
      row[key] = value;
      continue;
    }
    const { sql, params } = dialect.sqlToQuery(value);
    const m = /^coalesce\("(\w+)"\."(\w+)", 0\) \+ (?:\$(\d+)|(\d+))$/.exec(sql);
    if (!m || m[1] !== getTableName(table) || keys[m[2]] !== key) throw new Error(`fake db: 未対応の SET 式: ${key} = ${sql}`);
    const add = m[3] ? Number(params[Number(m[3]) - 1]) : Number(m[4]);
    row[key] = Number(row[key] ?? 0) + add;
  }
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

  /** 実行の前に待つもの（SELECT の足止めに使う） */
  protected before(): Promise<void> {
    return Promise.resolve();
  }

  then<A = T, B = never>(
    ok?: ((value: T) => A | PromiseLike<A>) | null,
    ng?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return this.before()
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
  private max = Infinity;

  constructor(db: FakeDb, table: PgTable, fields?: Fields) {
    super(db, table);
    this.fields = fields;
  }

  limit(n: number): this {
    this.max = n;
    return this;
  }

  protected before(): Promise<void> {
    return this.db.gate(this.table);
  }

  protected run(): Row[] {
    return this.hits("SELECT")
      .slice(0, this.max)
      .map((row) => project(this.table, row, this.fields));
  }
}

class UpdateQuery extends TableQuery<Row[] | undefined> {
  private values: Row = {};

  set(values: Row): this {
    this.values = values;
    return this;
  }

  protected run(): Row[] | undefined {
    this.db.failIfPlanned("update", this.table);
    const hit = this.hits("UPDATE");
    for (const row of hit) applySet(this.table, row, this.values);
    return this.returned(hit);
  }
}

class InsertQuery extends TableQuery<Row[] | undefined> {
  private row: Row = {};
  private ignoreConflict = false;

  values(values: Row): this {
    // 定数の既定値（total_gift_amount DEFAULT 0 など）は DB と同じく補う。now() などの SQL の既定値は扱わない
    const defaults = Object.entries(getTableColumns(this.table))
      .filter(([, col]) => col.default !== undefined && !(col.default instanceof SQL))
      .map(([key, col]) => [key, col.default]);
    this.row = { id: randomUUID(), ...Object.fromEntries(defaults), ...values };
    return this;
  }

  onConflictDoNothing(): this {
    this.ignoreConflict = true;
    return this;
  }

  protected run(): Row[] | undefined {
    this.db.failIfPlanned("insert", this.table);
    if (this.db.violatesUnique(this.table, this.row)) {
      if (this.ignoreConflict) return this.returned([]);
      throw new Error(`fake db: duplicate key value violates unique constraint (${getTableName(this.table)})`);
    }
    this.db.rows(this.table).push(this.row);
    return this.returned([this.row]);
  }
}

class FakeDb {
  private tables = new Map<PgTable, Row[]>();
  private readonly gates = new Map<PgTable, () => Promise<void>>();
  private planned: { op: "insert" | "update"; table: PgTable } | null = null;

  rows(table: PgTable): Row[] {
    let rows = this.tables.get(table);
    if (!rows) this.tables.set(table, (rows = []));
    return rows;
  }

  select(fields?: Fields) {
    return { from: (table: PgTable) => new SelectQuery(this, table, fields) };
  }

  insert(table: PgTable) {
    return new InsertQuery(this, table);
  }

  update(table: PgTable) {
    return new UpdateQuery(this, table);
  }

  /** ロールバックは表ごとの丸ごと復元で模す。同時に走らせるテストではこの中で例外を起こさないこと（もう一方の書き込みまで戻る） */
  async transaction<T>(fn: (tx: FakeDb) => Promise<T>): Promise<T> {
    const snapshot = new Map([...this.tables].map(([table, rows]) => [table, rows.map((r) => ({ ...r }))]));
    try {
      return await fn(this);
    } catch (e) {
      this.tables = snapshot;
      throw e;
    }
  }

  /** events の部分ユニーク (platform, platform_comment_id) WHERE platform_comment_id IS NOT NULL（drizzle/0004）。listeners に UNIQUE は無い */
  violatesUnique(table: PgTable, row: Row): boolean {
    if (table !== events || row.platformCommentId == null) return false;
    return this.rows(events).some((r) => r.platform === row.platform && r.platformCommentId === row.platformCommentId);
  }

  /** 次の 1 回だけ、指定した表への insert / update を失敗させる（接続断の模擬） */
  failNext(op: "insert" | "update", table: PgTable): void {
    this.planned = { op, table };
  }

  failIfPlanned(op: "insert" | "update", table: PgTable): void {
    if (this.planned?.op !== op || this.planned.table !== table) return;
    this.planned = null;
    throw new Error("fake db: connection lost");
  }

  /** この表への次の n 回の SELECT を、n 回そろうまで返さない。2 つの処理が「両方読んでから両方書く」順に進む状況を作る */
  holdSelects(table: PgTable, n: number): void {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => (release = resolve));
    let arrived = 0;
    this.gates.set(table, () => {
      arrived += 1;
      if (arrived >= n) {
        this.gates.delete(table);
        release();
      }
      return ready;
    });
  }

  gate(table: PgTable): Promise<void> {
    return this.gates.get(table)?.() ?? Promise.resolve();
  }
}

// ── テストデータ ────────────────────────────────────────────────
const USER_ID = "user-1";
const STREAMER_ID = "11111111-1111-4111-8111-111111111111";
const LISTENER_ID = "22222222-2222-4222-8222-222222222222";
const KICK_LISTENER_ID = "33333333-3333-4333-8333-333333333333";
const LIVE_ID = "76257563";
const OLD = new Date("2026-09-01T00:00:00Z");

function listenerRow(overrides: Row = {}): Row {
  return {
    id: LISTENER_ID,
    streamerId: STREAMER_ID,
    platform: "whowatch",
    platformUserId: "555",
    displayName: "リスナーA",
    nickname: null,
    notes: null,
    totalGiftAmount: 100,
    totalCommentCount: 0,
    lastSeenAt: OLD,
    createdAt: OLD,
    ...overrides,
  };
}

/** ふわっちのギフトコメント（BY_PLAYITEM）。パターン ID は付けない（照合で DB を引かず、個数 = item_count になる） */
function gift(id: number, itemCount: number, opts: { userId?: number; name?: string; anonymized?: boolean } = {}): LiveComment {
  const { userId = 555, name = "リスナーA", anonymized = false } = opts;
  return { id, comment_type: "BY_PLAYITEM", message: "", item_count: itemCount, anonymized, posted_at: 1790000000000 + id, user: { id: userId, name, user_path: `w:user${userId}` } };
}

function liveResponse(comments: LiveComment[]): LiveResponse {
  return { live: null, comments, updatedAt: 1790000000000, pollingInterval: 10_000, liveStatus: "PUBLISHING", ws: { url: null, jwt: null }, raw: {} };
}

const pollRequest = () =>
  new Request("https://tagdeck.jp/api/platforms/whowatch/live/poll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ liveId: LIVE_ID, lastUpdatedAt: 0 }),
  });

const kickRequest = (type: string, payload: Record<string, unknown>) =>
  new Request("https://tagdeck.jp/api/platforms/kick/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, payload }),
  });

/** ctx.waitUntil に渡された保存処理が、すべて終わるまで待つ */
async function settleBackground(): Promise<void> {
  await Promise.all(h.background.splice(0));
}

/** 1 台のブラウザの 1 回の poll（応答のあと、バックグラウンドの保存が終わるまで待つ） */
async function pollOnce(comments: LiveComment[]): Promise<void> {
  h.fetchLive.mockResolvedValueOnce(liveResponse(comments));
  const res = await livePoll(pollRequest());
  expect(res.status).toBe(200);
  await settleBackground();
}

let db: FakeDb;
let errorSpy: MockInstance<typeof console.error>;
const giftEvents = () => db.rows(events).filter((e) => e.eventType === "gift");
const listenerOf = (id: string) => db.rows(listeners).find((l) => l.id === id);

beforeEach(() => {
  h.user = { id: USER_ID };
  h.background = [];
  h.fetchLive.mockReset();
  db = new FakeDb();
  h.db = db;
  db.rows(streamerProfiles).push({ id: STREAMER_ID, userId: USER_ID, kickIsMonitoring: true, kickIsLive: false, kickLastEventAt: null, updatedAt: OLD });
  vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/platforms/whowatch/live/poll（ギフトの保存と累計）", () => {
  beforeEach(() => {
    db.rows(listeners).push(listenerRow());
  });

  it("同じギフトを 2 台のブラウザが受け取っても（同じ lastUpdatedAt の取り直しも同じ）、events は 1 件ずつ・累計は 1 回分だけ増える", async () => {
    const batch = [gift(9001, 3), gift(9002, 5)];

    await pollOnce(batch); // パソコン
    await pollOnce(batch); // スマホ（同じギフトを受け取る）

    expect(giftEvents().map((e) => e.platformCommentId)).toEqual(["9001", "9002"]);
    expect(giftEvents().every((e) => e.listenerId === LISTENER_ID)).toBe(true);
    expect(listenerOf(LISTENER_ID)).toMatchObject({ totalGiftAmount: 108 });
    expect(db.rows(listeners)).toHaveLength(1);
  });

  it("初めてのリスナーは累計 0 で作り、events に入った 1 回分だけ足す", async () => {
    const first = gift(9101, 4, { userId: 999, name: "はじめまして" });

    await pollOnce([first]);
    await pollOnce([first]);

    const created = db.rows(listeners).filter((l) => l.platformUserId === "999");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ streamerId: STREAMER_ID, platform: "whowatch", displayName: "はじめまして", totalGiftAmount: 4 });
    expect(giftEvents()).toEqual([expect.objectContaining({ listenerId: created[0].id, platformCommentId: "9101", streamId: LIVE_ID })]);
  });

  it("初めてのリスナーのギフトを 2 台が同時に処理しても、合計は 1 回分（リスナー行が 2 つできても、足すのは events に入れた方だけ）", async () => {
    // listeners に UNIQUE が無いため、同時に「無い」と読んだ 2 台がそれぞれ作る（従来からの挙動）。作るときに足すと 2 回分になる
    db.holdSelects(listeners, 2);
    const first = gift(9151, 4, { userId: 999, name: "はじめまして" });
    h.fetchLive.mockResolvedValueOnce(liveResponse([first])).mockResolvedValueOnce(liveResponse([first]));

    await Promise.all([livePoll(pollRequest()), livePoll(pollRequest())]);
    await settleBackground();

    const created = db.rows(listeners).filter((l) => l.platformUserId === "999");
    expect(created.reduce((sum, l) => sum + Number(l.totalGiftAmount), 0)).toBe(4);
    expect(giftEvents()).toHaveLength(1);
    expect(created.find((l) => l.id === giftEvents()[0].listenerId)).toMatchObject({ totalGiftAmount: 4 });
  });

  it("匿名のギフトは listener_id=null で保存し、リスナーは作らない・累計も変えない", async () => {
    const anon = gift(9201, 7, { anonymized: true }); // 投げ主の情報が付いていても伏せる

    await pollOnce([anon]);
    await pollOnce([anon]);

    expect(giftEvents()).toEqual([expect.objectContaining({ listenerId: null, platformCommentId: "9201" })]);
    expect(db.rows(listeners)).toEqual([listenerRow()]);
  });

  it("同じリスナーの別々のギフトを 2 台が同時に保存しても、両方足す（読んでから足すと片方が消える）", async () => {
    db.holdSelects(listeners, 2); // 両方がリスナーを読み終えてから書き始める
    h.fetchLive.mockResolvedValueOnce(liveResponse([gift(9301, 2)])).mockResolvedValueOnce(liveResponse([gift(9302, 5)]));

    const responses = await Promise.all([livePoll(pollRequest()), livePoll(pollRequest())]);
    await settleBackground();

    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(giftEvents()).toHaveLength(2);
    expect(listenerOf(LISTENER_ID)).toMatchObject({ totalGiftAmount: 107 });
  });

  it("累計の加算に失敗したら events の行も残さない（同じトランザクション）。次に同じギフトを受け取ったときにやり直せる", async () => {
    const g = gift(9401, 3);
    db.failNext("update", listeners);

    await pollOnce([g]); // 1 台目: 加算で接続が切れる → 保存ごと巻き戻る
    expect(giftEvents()).toHaveLength(0);
    expect(listenerOf(LISTENER_ID)).toMatchObject({ totalGiftAmount: 100 });
    expect(errorSpy).toHaveBeenCalledWith("[live/poll] バックグラウンド保存に失敗", expect.objectContaining({ commentId: "9401" }));

    await pollOnce([g]); // 2 台目（または次の取り直し）: 今度は保存も加算も通る
    expect(giftEvents()).toHaveLength(1);
    expect(listenerOf(LISTENER_ID)).toMatchObject({ totalGiftAmount: 103 });
  });
});

describe("POST /api/platforms/kick/event（同じ型の処理）", () => {
  const sender = { id: 777, username: "kick_user" };

  beforeEach(() => {
    db.rows(listeners).push(listenerRow({ id: KICK_LISTENER_ID, platform: "kick", platformUserId: "777", displayName: "kick_user", totalGiftAmount: 4, totalCommentCount: 10 }));
  });

  it("コメント: 初めてのリスナーは 0 で作ってから 1 足す。2 件目で 2 になる", async () => {
    const newcomer = { id: 888, username: "newcomer" };
    for (const content of ["はじめまして", "よろしく"]) {
      expect((await kickEvent(kickRequest("chat_message", { content, sender: newcomer }))).status).toBe(200);
    }

    const created = db.rows(listeners).filter((l) => l.platform === "kick" && l.platformUserId === "888");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ displayName: "newcomer", totalCommentCount: 2, totalGiftAmount: 0 });
    expect(db.rows(events).filter((e) => e.listenerId === created[0].id)).toHaveLength(2);
  });

  it("コメント: 同じリスナーのコメントが同時に 2 件届いても両方数える", async () => {
    db.holdSelects(listeners, 2);

    const responses = await Promise.all(["1 件目", "2 件目"].map((content) => kickEvent(kickRequest("chat_message", { content, sender }))));

    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(listenerOf(KICK_LISTENER_ID)).toMatchObject({ totalCommentCount: 12 });
    expect(db.rows(events)).toHaveLength(2);
  });

  it("ギフト: 既存リスナーの累計に 1 足し、events の listener_id は従来どおり null", async () => {
    const res = await kickEvent(kickRequest("gift_subscription", { gifter: sender, gifted_usernames: ["a", "b"] }));

    expect(res.status).toBe(200);
    expect(listenerOf(KICK_LISTENER_ID)).toMatchObject({ totalGiftAmount: 5, totalCommentCount: 10 });
    expect(db.rows(events)).toEqual([expect.objectContaining({ platform: "kick", eventType: "gift", listenerId: null })]);
  });

  it("ギフト: 送り主の無いイベントは events だけ保存し、リスナーは作らない", async () => {
    const res = await kickEvent(kickRequest("subscription", { months: 3 }));

    expect(res.status).toBe(200);
    expect(db.rows(events)).toHaveLength(1);
    expect(db.rows(listeners)).toHaveLength(1);
    expect(listenerOf(KICK_LISTENER_ID)).toMatchObject({ totalGiftAmount: 4 });
  });

  it("events の保存に失敗したら累計も足さない（保存と加算は同じトランザクション）", async () => {
    db.failNext("insert", events);

    await expect(kickEvent(kickRequest("chat_message", { content: "落ちる", sender }))).rejects.toThrow("connection lost");

    expect(db.rows(events)).toHaveLength(0);
    expect(listenerOf(KICK_LISTENER_ID)).toMatchObject({ totalCommentCount: 10 });
  });
});
