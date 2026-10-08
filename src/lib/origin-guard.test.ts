import { describe, expect, it } from "vitest";
import { isCrossSiteWrite } from "./origin-guard";

const base = { pathname: "/api/events", requestHost: "tagdeck.jp", isAllowedAppOrigin: false };

describe("isCrossSiteWrite（別サイトからの /api/* への書き込みを見分ける）", () => {
  it("別サイトの Origin が付いた POST / PUT / PATCH / DELETE は拒む", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
      expect(isCrossSiteWrite({ ...base, method, origin: "https://evil.example" })).toBe(true);
    }
  });

  it("自分のサイトからの書き込みは通す（ポートも含めて一致）", () => {
    expect(isCrossSiteWrite({ ...base, method: "POST", origin: "https://tagdeck.jp" })).toBe(false);
    expect(isCrossSiteWrite({ ...base, method: "POST", origin: "http://localhost:3000", requestHost: "localhost:3000" })).toBe(false);
    expect(isCrossSiteWrite({ ...base, method: "POST", origin: "http://localhost:3001", requestHost: "localhost:3000" })).toBe(true);
  });

  it("スマホアプリ（許可した Origin）からの書き込みは通す", () => {
    expect(isCrossSiteWrite({ ...base, method: "POST", origin: "https://localhost", isAllowedAppOrigin: true })).toBe(false);
  });

  it("Origin が無い要求は判定しない（各ルートの認証に任せる）", () => {
    expect(isCrossSiteWrite({ ...base, method: "POST", origin: null })).toBe(false);
  });

  it("GET / HEAD / OPTIONS は対象外。/api/ 以外のパスも対象外", () => {
    expect(isCrossSiteWrite({ ...base, method: "GET", origin: "https://evil.example" })).toBe(false);
    expect(isCrossSiteWrite({ ...base, method: "OPTIONS", origin: "https://evil.example" })).toBe(false);
    expect(isCrossSiteWrite({ ...base, method: "POST", origin: "https://evil.example", pathname: "/live" })).toBe(false);
  });

  it('"null" や壊れた Origin は別サイト扱い', () => {
    expect(isCrossSiteWrite({ ...base, method: "POST", origin: "null" })).toBe(true);
    expect(isCrossSiteWrite({ ...base, method: "POST", origin: "not a url" })).toBe(true);
  });

  it("サブドメインや似た名前は別サイト", () => {
    expect(isCrossSiteWrite({ ...base, method: "POST", origin: "https://tagdeck.jp.evil.example" })).toBe(true);
    expect(isCrossSiteWrite({ ...base, method: "POST", origin: "https://evil.example@tagdeck.jp" })).toBe(false);
    expect(isCrossSiteWrite({ ...base, method: "POST", origin: "https://www.tagdeck.jp" })).toBe(true);
  });
});