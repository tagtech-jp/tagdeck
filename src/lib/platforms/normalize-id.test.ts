import { describe, it, expect } from "vitest";
import { normalizePlatformId } from "./normalize-id";

describe("normalizePlatformId", () => {
  it("extracts the handle from a pasted whowatch profile URL", () => {
    expect(normalizePlatformId("https://whowatch.tv/@erupi2525", "whowatch")).toBe("erupi2525");
    expect(normalizePlatformId("whowatch.tv/erupi2525", "whowatch")).toBe("erupi2525");
  });

  it("keeps the w:/t: prefix from a pasted whowatch /profile/ URL", () => {
    // 回帰: 旧実装は "profile" を ID として抽出していた
    expect(normalizePlatformId("https://whowatch.tv/profile/w:Thomas19981022", "whowatch")).toBe("w:Thomas19981022");
    expect(normalizePlatformId("https://whowatch.tv/profile/t:kuroppi1022", "whowatch")).toBe("t:kuroppi1022");
  });

  it("extracts the username from a pasted Kick profile URL", () => {
    expect(normalizePlatformId("https://kick.com/xqc", "kick")).toBe("xqc");
  });

  it("extracts the numeric id from a pasted niconico profile URL", () => {
    expect(normalizePlatformId("https://www.nicovideo.jp/user/12345678", "niconico")).toBe(
      "12345678"
    );
  });

  it("trims whitespace and passes through a bare handle unchanged", () => {
    expect(normalizePlatformId("  @erupi2525  ", "whowatch")).toBe("@erupi2525");
    expect(normalizePlatformId(" xqc ", "kick")).toBe("xqc");
  });

  it("returns an empty string for empty input", () => {
    expect(normalizePlatformId("", "kick")).toBe("");
    expect(normalizePlatformId("   ", "niconico")).toBe("");
  });
});
