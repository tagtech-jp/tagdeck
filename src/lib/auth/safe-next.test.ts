import { describe, expect, it } from "vitest";
import { DEFAULT_NEXT_PATH, safeNextPath } from "./safe-next";

describe("safeNextPath（ログイン後の戻り先はサイト内のパスだけ）", () => {
  it("サイト内のパスはそのまま（query・hash も保つ）", () => {
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
    expect(safeNextPath("/dashboard/settings")).toBe("/dashboard/settings");
    expect(safeNextPath("/live?debug=1#se")).toBe("/live?debug=1#se");
    expect(safeNextPath("  /events  ")).toBe("/events");
  });

  it("無い・空・/ で始まらないものは既定の戻り先", () => {
    expect(safeNextPath(null)).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath(undefined)).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath("")).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath("dashboard")).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath("https://tagdeck.jp/dashboard")).toBe(DEFAULT_NEXT_PATH);
  });

  it("別サイトへ飛ぶ形は既定の戻り先（オープンリダイレクトの入口を閉じる）", () => {
    // `${origin}${next}` で host が差し替わる形
    expect(safeNextPath("@evil.example/x")).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath(".evil.example")).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath(":8443@evil.example")).toBe(DEFAULT_NEXT_PATH);
    // スキーム相対 URL
    expect(safeNextPath("//evil.example/x")).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath("/\\evil.example")).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath("///evil.example")).toBe(DEFAULT_NEXT_PATH);
    // 制御文字・空白を含むもの
    expect(safeNextPath("/dash\nboard")).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath("/dash board")).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath("/\u0000")).toBe(DEFAULT_NEXT_PATH);
    // javascript: 等はそもそも / で始まらない
    expect(safeNextPath("javascript:alert(1)")).toBe(DEFAULT_NEXT_PATH);
  });

  it("fallback を指定できる", () => {
    expect(safeNextPath("//evil.example", "/login")).toBe("/login");
  });
});