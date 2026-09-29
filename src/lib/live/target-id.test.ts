import { describe, expect, it } from "vitest";
import { isOwnWhowatchTarget, resolveInitialTarget } from "./target-id";

describe("resolveInitialTarget（配信者ID欄の既定）", () => {
  it("何も保存されていなければ、連携 ID を入れて固定 ON", () => {
    expect(resolveInitialTarget({ savedId: null, pinChoice: null, source: null, linkedId: "Thomas19981022" })).toEqual({ targetId: "Thomas19981022", pinned: true, source: "linked" });
  });

  it("連携 ID がまだ読めていなければ空欄で固定 ON（読めた時点でもう一度呼ぶ）", () => {
    expect(resolveInitialTarget({ savedId: null, pinChoice: null, source: null, linkedId: null })).toEqual({ targetId: "", pinned: true, source: "linked" });
  });

  it("自分で打った ID を固定していればそのまま（連携 ID より優先）", () => {
    expect(resolveInitialTarget({ savedId: "w:other", pinChoice: "1", source: "typed", linkedId: "Thomas19981022" })).toEqual({ targetId: "w:other", pinned: true, source: "typed" });
  });

  it("連携 ID から入った値は、設定の ID が変わったら追従する", () => {
    expect(resolveInitialTarget({ savedId: "oldId", pinChoice: null, source: "linked", linkedId: "newId" })).toEqual({ targetId: "newId", pinned: true, source: "linked" });
  });

  it("旧版の保存値（source なし）は連携 ID を優先する（旧版で固定していた自分の ID を既定の固定に揃える）", () => {
    expect(resolveInitialTarget({ savedId: "oldId", pinChoice: null, source: null, linkedId: "Thomas19981022" }).targetId).toBe("Thomas19981022");
  });

  it("自分で固定を外していれば空欄・固定 OFF のまま", () => {
    expect(resolveInitialTarget({ savedId: "x", pinChoice: "0", source: "typed", linkedId: "Thomas19981022" })).toEqual({ targetId: "", pinned: false, source: "typed" });
  });
});

describe("isOwnWhowatchTarget", () => {
  it("空欄・同じ ID・prefix 違い・@・プロフィール URL は自分", () => {
    expect(isOwnWhowatchTarget("", "Thomas19981022")).toBe(true);
    expect(isOwnWhowatchTarget("Thomas19981022", "Thomas19981022")).toBe(true);
    expect(isOwnWhowatchTarget("w:Thomas19981022", "Thomas19981022")).toBe(true);
    expect(isOwnWhowatchTarget("@Thomas19981022", "w:Thomas19981022")).toBe(true);
    expect(isOwnWhowatchTarget("https://whowatch.tv/profile/w:Thomas19981022", "Thomas19981022")).toBe(true);
  });

  it("別の ID・大文字小文字違い・連携 ID なしは自分ではない", () => {
    expect(isOwnWhowatchTarget("kuroppi1022", "Thomas19981022")).toBe(false);
    expect(isOwnWhowatchTarget("thomas19981022", "Thomas19981022")).toBe(false);
    expect(isOwnWhowatchTarget("Thomas19981022", null)).toBe(false);
  });
});
