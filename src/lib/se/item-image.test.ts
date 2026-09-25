import { describe, expect, it } from "vitest";
import { pickItemImage } from "./item-image";

describe("pickItemImage", () => {
  it("アイテム名と同じ名前の通常パターンの画像を最優先で選ぶ", () => {
    const patterns = [
      { patternName: "ひよこのあたり", imageUrl: "https://img/hit.png", isHit: true },
      { patternName: "ひよこ", imageUrl: "https://img/plain.png", isHit: false },
    ];
    expect(pickItemImage("ひよこ", patterns)).toBe("https://img/plain.png");
  });

  it("同名パターンが無ければ当たりでない最初の画像、それも無ければ最初の画像", () => {
    expect(pickItemImage("花火", [{ patternName: "花火A", imageUrl: "https://img/a.png", isHit: false }, { patternName: "花火B", imageUrl: "https://img/b.png", isHit: false }])).toBe("https://img/a.png");
    expect(pickItemImage("ボーナス", [{ patternName: "大当たり", imageUrl: "https://img/big.png", isHit: true }])).toBe("https://img/big.png");
  });

  it("画像が無い・空文字のパターンは飛ばし、1 つも無ければ null", () => {
    expect(pickItemImage("x", [{ patternName: "x", imageUrl: "  ", isHit: false }, { patternName: "y", imageUrl: "https://img/y.png", isHit: false }])).toBe("https://img/y.png");
    expect(pickItemImage("x", [{ patternName: "x", imageUrl: null, isHit: false }])).toBeNull();
    expect(pickItemImage("x", [])).toBeNull();
  });
});
