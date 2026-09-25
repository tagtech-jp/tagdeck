import { describe, expect, it } from "vitest";
import { resumeWithTimeout } from "./engine";

describe("resumeWithTimeout（無音後の復帰）", () => {
  it("running ならそのまま true", async () => {
    expect(await resumeWithTimeout({ state: "running", resume: async () => undefined }, 100)).toBe(true);
  });
  it("suspended → resume() で running になれば true", async () => {
    const c = { state: "suspended", resume: async () => { c.state = "running"; } };
    expect(await resumeWithTimeout(c, 100)).toBe(true);
  });
  it("resume() が永久に pending でも timeout で抜けて false", async () => {
    const c = { state: "suspended", resume: () => new Promise<void>(() => {}) };
    const t0 = Date.now();
    expect(await resumeWithTimeout(c, 50)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  it("resume() が reject しても例外にせず false", async () => {
    const c = { state: "interrupted", resume: async () => { throw new Error("NotAllowed"); } };
    expect(await resumeWithTimeout(c, 100)).toBe(false);
  });
  it("closed は再開できないので false（呼び出し側で作り直す）", async () => {
    expect(await resumeWithTimeout({ state: "closed", resume: async () => undefined }, 100)).toBe(false);
  });
});
