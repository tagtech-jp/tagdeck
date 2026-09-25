import { describe, expect, it } from "vitest";
import { expandablePatternRows } from "./pattern-rows";

const p = (patternId: number, patternName: string, isHit = false) => ({ patternId, patternName, isHit });

describe("expandablePatternRows", () => {
  it("全パターンが同名なら 1 行も出さない（水上花火: 17 パターンすべて同一）", () => {
    const patterns = Array.from({ length: 17 }, (_, i) => p(1543 + i, "水上花火"));
    expect(expandablePatternRows("水上花火", patterns)).toEqual([]);
  });

  it("当たりは常に出す（アイテム名と同じ素の絵柄は出さない）", () => {
    const rows = expandablePatternRows("ひよこ", [p(1, "ひよこ"), p(2, "ひよこのあたり", true)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("ひよこのあたり");
    expect(rows[0].isHit).toBe(true);
  });

  it("名前が複数種類あるアイテムは、アイテム名と違う名前を個別行にする", () => {
    const rows = expandablePatternRows("ボーナス", [p(1, "ボーナス"), p(2, "大爆発"), p(3, "超特大")]);
    expect(rows.map((r) => r.label)).toEqual(["大爆発", "超特大"]);
  });

  it("同じ名前が複数 pattern_id に散っている場合は 1 行にまとめ、全 id を持つ", () => {
    const rows = expandablePatternRows("コレクション", [p(1, "コレクション"), p(2, "夜の花"), p(3, "夜の花"), p(4, "朝の花")]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.label === "夜の花")?.patternIds).toEqual([2, 3]);
    expect(rows.find((r) => r.label === "朝の花")?.patternIds).toEqual([4]);
  });

  it("当たりが同名で複数あってもまとめる", () => {
    const rows = expandablePatternRows("くじ", [p(1, "くじ"), p(2, "くじのあたり", true), p(3, "くじのあたり", true)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].patternIds).toEqual([2, 3]);
  });

  it("同名グループに当たりが混ざっていたら当たり扱いにし、代表も当たりにする", () => {
    const rows = expandablePatternRows("くじ", [p(10, "特殊", false), p(11, "特殊", true)]);
    expect(rows[0].isHit).toBe(true);
    expect(rows[0].representative.patternId).toBe(11);
  });

  it("パターンが 1 つだけなら出さない（アイテム行で足りる）", () => {
    expect(expandablePatternRows("延長ギフト", [p(1, "延長ギフト")])).toEqual([]);
  });

  it("アイテム名と一致しない単独パターンでも、名前が 1 種類なら出さない", () => {
    // 名前が 1 種類しか無い＝そのアイテムのギフトは必ずその名前。アイテム行と同じ意味になる
    expect(expandablePatternRows("表示名ちがい", [p(1, "内部名"), p(2, "内部名")])).toEqual([]);
  });
});
