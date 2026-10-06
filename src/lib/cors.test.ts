import { describe, expect, it } from "vitest";
import { allowedAppOrigins, applyCorsHeaders, corsHeadersFor, DEFAULT_APP_ORIGINS, isAllowedAppOrigin } from "./cors";

describe("allowedAppOrigins / isAllowedAppOrigin", () => {
  it("既定は Capacitor の 2 つ。環境変数のカンマ区切りを足せる（空白と末尾スラッシュは無視）", () => {
    expect([...allowedAppOrigins()]).toEqual([...DEFAULT_APP_ORIGINS]);
    const a = allowedAppOrigins(" http://localhost:5173/ ,, https://dev.example ");
    expect(a.has("http://localhost:5173")).toBe(true);
    expect(a.has("https://dev.example")).toBe(true);
    expect(a.size).toBe(4);
  });

  it("許可リストに無い Origin・空は拒む（ブラウザのサイト https://tagdeck.jp 自身も付けない = 同一生成元で動く）", () => {
    const a = allowedAppOrigins("http://localhost:5173");
    expect(isAllowedAppOrigin("https://localhost", a)).toBe(true);
    expect(isAllowedAppOrigin("capacitor://localhost", a)).toBe(true);
    expect(isAllowedAppOrigin("http://localhost:5173", a)).toBe(true);
    expect(isAllowedAppOrigin("https://evil.example", a)).toBe(false);
    expect(isAllowedAppOrigin("https://tagdeck.jp", a)).toBe(false);
    expect(isAllowedAppOrigin(null, a)).toBe(false);
    expect(isAllowedAppOrigin("", a)).toBe(false);
  });
});

describe("corsHeadersFor / applyCorsHeaders", () => {
  it("Origin をそのまま返し、Authorization を許し、Credentials は付けない", () => {
    const h = corsHeadersFor("https://localhost");
    expect(h["Access-Control-Allow-Origin"]).toBe("https://localhost");
    expect(h["Access-Control-Allow-Headers"]).toContain("Authorization");
    expect(h["Access-Control-Allow-Methods"]).toContain("OPTIONS");
    expect(h.Vary).toBe("Origin");
    expect(Object.keys(h)).not.toContain("Access-Control-Allow-Credentials");
  });

  it("既存の Vary に Origin を足す（重複させない）", () => {
    const headers = new Headers({ Vary: "Accept-Encoding" });
    applyCorsHeaders(headers, "capacitor://localhost");
    expect(headers.get("Vary")).toBe("Accept-Encoding, Origin");
    applyCorsHeaders(headers, "capacitor://localhost");
    expect(headers.get("Vary")).toBe("Accept-Encoding, Origin");
    expect(headers.get("Access-Control-Allow-Origin")).toBe("capacitor://localhost");
  });
});
