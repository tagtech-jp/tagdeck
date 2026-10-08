import { afterEach, describe, expect, it, vi } from "vitest";
import { errorDetail } from "./error-detail";

describe("errorDetail（監査 §3-9: 本番ではエラーの詳細を応答に出さない）", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("本番では detail を返さない（キー自体を付けない）", () => {
    vi.stubEnv("NODE_ENV", "production");
    const r = errorDetail('column "learned_point" does not exist');
    expect(r).toEqual({});
    expect("detail" in r).toBe(false);
    expect(JSON.stringify({ error: "x", ...r })).toBe('{"error":"x"}');
  });

  it("開発・テストでは従来どおり detail を返す", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(errorDetail("whowatch API 503")).toEqual({ detail: "whowatch API 503" });
    vi.stubEnv("NODE_ENV", "test");
    expect(errorDetail("x")).toEqual({ detail: "x" });
  });
});
