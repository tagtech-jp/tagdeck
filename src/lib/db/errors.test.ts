import { describe, expect, it } from "vitest";
import { dbConstraintErrorResponse, pgErrorCode } from "./errors";

describe("pgErrorCode", () => {
  it("returns SQLSTATE from a postgres error", () => {
    expect(pgErrorCode({ code: "23503" })).toBe("23503");
  });

  it("returns SQLSTATE from a wrapped DrizzleQueryError (cause)", () => {
    const wrapped = Object.assign(new Error("Failed query"), { cause: { code: "23505" } });
    expect(pgErrorCode(wrapped)).toBe("23505");
  });

  it("returns null for non-pg errors", () => {
    expect(pgErrorCode(new Error("boom"))).toBeNull();
    expect(pgErrorCode(null)).toBeNull();
    expect(pgErrorCode("x")).toBeNull();
  });
});

describe("dbConstraintErrorResponse", () => {
  it("maps FK violation to 409 USER_NOT_INITIALIZED", async () => {
    const res = dbConstraintErrorResponse({ code: "23503" });
    expect(res?.status).toBe(409);
    expect(((await res!.json()) as { code?: string }).code).toBe("USER_NOT_INITIALIZED");
  });

  it("maps unique violation to 409 DUPLICATE", async () => {
    const res = dbConstraintErrorResponse({ cause: { code: "23505" } });
    expect(res?.status).toBe(409);
    expect(((await res!.json()) as { code?: string }).code).toBe("DUPLICATE");
  });

  it("returns null for other errors so callers rethrow", () => {
    expect(dbConstraintErrorResponse({ code: "42P01" })).toBeNull();
    expect(dbConstraintErrorResponse(new Error("x"))).toBeNull();
  });
});
