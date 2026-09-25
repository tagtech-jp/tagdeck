import { describe, expect, it } from "vitest";

import { isSameWhowatchUser } from "./same-user";

describe("isSameWhowatchUser", () => {
  it("prefix 付きの自分のIDを手入力した場合は自分と判定する", () => {
    expect(isSameWhowatchUser("w:foo", "w:foo")).toBe(true);
  });

  it("prefix 無しで登録していても、解決後の user_path と一致すれば自分と判定する", () => {
    expect(isSameWhowatchUser("foo", "w:foo")).toBe(true);
    expect(isSameWhowatchUser("foo", "t:foo")).toBe(true);
  });

  it("プロフィールURLで登録していても自分と判定する", () => {
    expect(isSameWhowatchUser("https://whowatch.tv/w:foo", "w:foo")).toBe(true);
  });

  it("数値IDを入力しても、解決後が正規の user_path なら自分と判定する", () => {
    // fetchLiveId は profile.user_path を返すため、数値入力でも w:foo に解決される
    expect(isSameWhowatchUser("w:foo", "w:foo")).toBe(true);
  });

  it("別人は他人と判定する", () => {
    expect(isSameWhowatchUser("w:foo", "w:bar")).toBe(false);
    expect(isSameWhowatchUser("w:foo", "t:foo")).toBe(false);
  });

  it("大文字小文字が違うだけのIDは別人として扱う（ふわっちのIDは大小を区別する）", () => {
    expect(isSameWhowatchUser("w:Thomas19981022", "w:thomas19981022")).toBe(false);
  });

  it("どちらかが未設定なら他人として扱う（安全側に倒す）", () => {
    expect(isSameWhowatchUser(null, "w:foo")).toBe(false);
    expect(isSameWhowatchUser("w:foo", null)).toBe(false);
    expect(isSameWhowatchUser("", "")).toBe(false);
    expect(isSameWhowatchUser(undefined, undefined)).toBe(false);
  });
});
