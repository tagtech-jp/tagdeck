// @ts-nocheck — vitest は devDependency
import { describe, it, expect } from "vitest";
import { humanizeEventKey, resolveEventDisplayName } from "./event-title";

describe("humanizeEventKey", () => {
  it("converts snake/kebab to spaced words", () => {
    expect(humanizeEventKey("monthly_2026_05")).toBe("Monthly 2026 05");
    expect(humanizeEventKey("weekend-1")).toBe("Weekend 1");
  });

  it("converts a leading YYYY_MM_ prefix to a Japanese year/month label", () => {
    expect(humanizeEventKey("2026_07_samba_carnival")).toBe("2026年7月 Samba Carnival");
    expect(humanizeEventKey("2026_1_new_year")).toBe("2026年1月 New Year");
  });

  it("does not treat a non-YYYY_MM prefix as a date", () => {
    // "monthly" は年ではないため通常の整形にフォールバック
    expect(humanizeEventKey("monthly_2026_05")).not.toContain("年");
  });

  it("returns original for empty parts", () => {
    expect(humanizeEventKey("")).toBe("");
  });
});

describe("resolveEventDisplayName", () => {
  it("prefers the manual dictionary entry when present", () => {
    expect(resolveEventDisplayName("whowatchgrandprix")).toBe("WGP");
  });

  it("matches the dictionary after stripping a real YYYY_MM_ date prefix (2026-07-24 実データ確認)", () => {
    // 実データでは event_key が "2026_07_whowatchgrandprix" のように日付プレフィックス付きで返る
    expect(resolveEventDisplayName("2026_07_whowatchgrandprix")).toBe("WGP");
  });

  it("falls back to humanized event_key when not in the dictionary", () => {
    expect(resolveEventDisplayName("monthly_2026_05")).toBe("Monthly 2026 05");
    expect(resolveEventDisplayName("2026_07_samba_carnival")).toBe("2026年7月 Samba Carnival");
  });

  it("ignores the _readme key as a lookup target", () => {
    expect(resolveEventDisplayName("_readme")).toBe(humanizeEventKey("_readme"));
  });

  it("falls back for empty event_key", () => {
    expect(resolveEventDisplayName("")).toBe("");
  });
});
