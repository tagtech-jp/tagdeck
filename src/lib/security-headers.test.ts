import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS, securityHeaderRules } from "./security-headers";

describe("SECURITY_HEADERS（Worker の応答と静的アセットで同じ値）", () => {
  it("必要なヘッダーが揃っている", () => {
    const keys = SECURITY_HEADERS.map((h) => h.key);
    expect(keys).toEqual(
      expect.arrayContaining(["Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy", "Content-Security-Policy"]),
    );
    expect(SECURITY_HEADERS.find((h) => h.key === "X-Frame-Options")?.value).toBe("DENY");
    expect(SECURITY_HEADERS.find((h) => h.key === "Content-Security-Policy")?.value).toContain("frame-ancestors 'none'");
    expect(SECURITY_HEADERS.find((h) => h.key === "Strict-Transport-Security")?.value).toMatch(/^max-age=\d{7,}/);
  });

  it("securityHeaderRules() は全パス（/:path*）に全ヘッダーを返す", () => {
    const rules = securityHeaderRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");
    for (const h of SECURITY_HEADERS) expect(rules[0].headers).toContainEqual(h);
  });

  it("public/_headers の /* ブロックに同じ値が写されている（静的アセットは next.config.ts を通らない）", () => {
    const text = readFileSync(join(process.cwd(), "public", "_headers"), "utf8");
    // "/*" の行から次のパス行（先頭が / で始まる行）までを切り出す
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex((l) => l.trim() === "/*");
    expect(start).toBeGreaterThanOrEqual(0);
    const block: string[] = [];
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^\S/.test(l) && l.trim() !== "") break;
      if (l.trim() !== "" && !l.trim().startsWith("#")) block.push(l.trim());
    }
    for (const h of SECURITY_HEADERS) {
      expect(block).toContain(`${h.key}: ${h.value}`);
    }
  });

  it("next.config.ts が securityHeaderRules() を headers() で返し、poweredByHeader を切っている（本文を読んで確かめる。import すると public/ 全体のハッシュ計算が走り遅い）", () => {
    const text = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
    expect(text).toMatch(/import \{ securityHeaderRules \} from "\.\/src\/lib\/security-headers";/);
    expect(text).toMatch(/poweredByHeader:\s*false/);
    expect(text).toMatch(/async headers\(\)\s*\{\s*return securityHeaderRules\(\);\s*\}/);
  });
});