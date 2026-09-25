import { describe, expect, it } from "vitest";
import { describePresetDbError } from "./presets-db";

describe("describePresetDbError", () => {
  it("テーブル未作成（42P01）は 503 と SQL 適用の案内", () => {
    const err = Object.assign(new Error("Failed query: select ... from se_presets"), { cause: Object.assign(new Error('relation "se_presets" does not exist'), { code: "42P01" }) });
    const r = describePresetDbError(err);
    expect(r.status).toBe(503);
    expect(r.error).toContain("0018_se_presets_manual.sql");
  });
  it("それ以外は 500 と要約（SQL 全文は含めない）", () => {
    const err = new Error("Failed query: insert into se_presets (...) values (...)\nparams: a,b,c");
    const r = describePresetDbError(err);
    expect(r.status).toBe(500);
    expect(r.error).not.toContain("params:");
    expect(r.error).not.toContain("values (");
  });
});
