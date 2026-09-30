import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { ownedSimulator, SIMULATOR_DELETED_STATUS } from "./simulator-scope";

describe("ownedSimulator", () => {
  it("id・本人・削除済みでない、の 3 条件を AND で持つ", () => {
    const q = new PgDialect().sqlToQuery(ownedSimulator("sim-1", "user-1"));
    expect(q.sql).toContain('"event_simulators"."id" = $1');
    expect(q.sql).toContain('"event_simulators"."user_id" = $2');
    expect(q.sql).toContain('"event_simulators"."status" <> $3');
    expect(q.sql.match(/ and /g)).toHaveLength(2);
    expect(q.params).toEqual(["sim-1", "user-1", SIMULATOR_DELETED_STATUS]);
  });

  it("削除済みの status は deleted（一覧・Cron の active 絞り込みから外れる値）", () => {
    expect(SIMULATOR_DELETED_STATUS).toBe("deleted");
  });
});
