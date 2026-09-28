import { describe, expect, it } from "vitest";
import { bulkGradeFor, bulkItemKey, bulkKey, BULK_KEY_RE_SOURCE, describeDecorations, parseDecorations } from "./bulk-grade";

// しきい値は 2026-09-28 の /lives/{id}/playitems3 実応答（釣り竿 25/50/100/200・花火 2/5/10 など）
const rod = parseDecorations([
  { count: 25, pattern_decoration: "COOL" },
  { count: 50, pattern_decoration: "GREAT" },
  { count: 100, pattern_decoration: "FANTASTIC" },
  { count: 200, pattern_decoration: "MIRACLE" },
]);

describe("parseDecorations", () => {
  it("API の pattern_decorations を count 昇順の段階配列にする", () => {
    expect(rod).toEqual([
      { count: 25, grade: "COOL" },
      { count: 50, grade: "GREAT" },
      { count: 100, grade: "FANTASTIC" },
      { count: 200, grade: "MIRACLE" },
    ]);
  });

  it("段階名の無いもの・count の無いもの・未知の段階は落とす。同じ段階は小さい count を採る", () => {
    expect(parseDecorations([{ count: 5, image_url: "x.png" }, { pattern_decoration: "COOL" }, { count: 3, pattern_decoration: "SUPER" }, { count: 9, pattern_decoration: "GREAT" }, { count: 4, pattern_decoration: "GREAT" }])).toEqual([{ count: 4, grade: "GREAT" }]);
    expect(parseDecorations(null)).toEqual([]);
    expect(parseDecorations("x")).toEqual([]);
  });
});

describe("bulkGradeFor", () => {
  it("ふわっち本体と同じく、count の降順で最初に count <= 個数 を満たす段階", () => {
    expect(bulkGradeFor(rod, 1)).toBeNull();
    expect(bulkGradeFor(rod, 24)).toBeNull();
    expect(bulkGradeFor(rod, 25)).toBe("COOL");
    expect(bulkGradeFor(rod, 99)).toBe("GREAT");
    expect(bulkGradeFor(rod, 100)).toBe("FANTASTIC");
    expect(bulkGradeFor(rod, 999)).toBe("MIRACLE");
  });

  it("しきい値の無いアイテム（投票券）は何個投げても段階なし", () => {
    expect(bulkGradeFor([], 122)).toBeNull();
    expect(bulkGradeFor(null, 122)).toBeNull();
  });

  it("一部の花火系（COOL 2 / GREAT 3 / FANTASTIC 5 / MIRACLE 10）", () => {
    const fw = parseDecorations([{ count: 10, pattern_decoration: "MIRACLE" }, { count: 2, pattern_decoration: "COOL" }, { count: 5, pattern_decoration: "FANTASTIC" }, { count: 3, pattern_decoration: "GREAT" }]);
    expect(bulkGradeFor(fw, 2)).toBe("COOL");
    expect(bulkGradeFor(fw, 4)).toBe("GREAT");
    expect(bulkGradeFor(fw, 10)).toBe("MIRACLE");
  });
});

describe("keys", () => {
  it("bulk:{段階} と bulk:item:{id}:{段階} を作り、KEY_RE の断片が両方に一致する", () => {
    const re = new RegExp(`^(${BULK_KEY_RE_SOURCE})$`);
    expect(bulkKey("COOL")).toBe("bulk:COOL");
    expect(bulkItemKey(13098, "MIRACLE")).toBe("bulk:item:13098:MIRACLE");
    expect(re.test("bulk:COOL")).toBe(true);
    expect(re.test("bulk:item:13098:MIRACLE")).toBe(true);
    expect(re.test("bulk:SUPER")).toBe(false);
    expect(re.test("bulk:item:x:COOL")).toBe(false);
  });

  it("describeDecorations は日本語の段階名と個数を並べる", () => {
    expect(describeDecorations(rod)).toBe("クール 25個〜 / グレート 50個〜 / ファンタスティック 100個〜 / ミラクル 200個〜");
    expect(describeDecorations([])).toBe("");
  });
});
