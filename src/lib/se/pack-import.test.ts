import { describe, expect, it } from "vitest";
import { classifyPackFile, PACK_GENERIC, PACK_HIT, packCategoryLabel, planPackImport, type PackFile, type PackItem } from "./pack-import";

describe("classifyPackFile（フォルダ名・ファイル名 → 分類）", () => {
  it.each([
    // サブフォルダ名（近い方から）
    ["pack/花火/01.mp3", "fireworks"],
    ["pack/fireworks/long/01.mp3", "fireworks"],
    // 近いフォルダが優先（big = BIG ボーナス → 当たり）
    ["pack/fireworks/big/01.mp3", PACK_HIT],
    ["pack/ねこ/nya.wav", "cat"],
    // ファイル名（パチンコ・パチスロの用語は近いテーマへ）
    ["se/kakutei_03.wav", "jackpot"],
    ["se/確定音.mp3", "jackpot"],
    ["se/先バレ_01.mp3", "jackpot"],
    ["se/premium_long.mp3", "epic"],
    ["se/激アツ予告.mp3", "epic"],
    ["se/reach_01.mp3", "casino"],
    ["se/リーチ.mp3", "casino"],
    ["se/big_bonus.mp3", PACK_HIT],
    ["se/大当たり.mp3", PACK_HIT],
    ["se/miracle_fanfare.mp3", "bulk-MIRACLE"],
    ["se/クール.mp3", "bulk-COOL"],
    ["se/fanfare_02.mp3", "fanfare"],
    ["se/coin_shower.mp3", "coin"],
    // 自動ライブラリのアイテム名の規則（ワン → 犬・ぶた）
    ["se/ワン.mp3", "dog"],
    ["se/ぶたさん.mp3", "pig"],
    // 英単語は語の境界で見る（white の hit・coolant の cool には当てない）
    ["se/white_noise.mp3", PACK_GENERIC],
    ["se/coolant.mp3", PACK_GENERIC],
    // どれにも当たらない
    ["misc/a.mp3", PACK_GENERIC],
    ["a.mp3", PACK_GENERIC],
    // 選んだフォルダそのもの（先頭）は最後に見る
    ["確定音/01.mp3", "jackpot"],
    ["確定音/ねこ.mp3", "cat"],
    ["パチ音源/01.mp3", PACK_GENERIC],
  ])("%s → %s", (path, cat) => {
    expect(classifyPackFile(path)).toBe(cat);
  });
});

describe("packCategoryLabel", () => {
  it("テーマ・当たり・段階・分類なしの表示名", () => {
    expect(packCategoryLabel("fireworks")).toBe("花火");
    expect(packCategoryLabel(PACK_HIT)).toBe("当たり");
    expect(packCategoryLabel("bulk-COOL")).toBe("まとめ投げ クール");
    expect(packCategoryLabel(PACK_GENERIC)).toContain("分類なし");
  });
});

const f = (relPath: string, size = 1000): PackFile => ({ name: relPath.split("/").pop()!, relPath, size });

describe("planPackImport（取り込み計画）", () => {
  const files: PackFile[] = [
    f("p/花火/a.mp3"), // 0
    f("p/花火/b.mp3"), // 1
    f("p/ねこ/c.mp3"), // 2
    f("p/misc/d.mp3"), // 3 generic
    f("p/big_bonus.mp3"), // 4 hit
    f("p/miracle.mp3"), // 5 bulk-MIRACLE
    f("p/readme.txt"), // 6 対象外
    f("p/huge.wav", 21 * 1024 * 1024), // 7 対象外
  ];
  const items: PackItem[] = [
    { itemId: 1, itemName: "ふわっち11周年記念花火", patterns: [{ patternId: 10, isHit: false }] },
    { itemId: 2, itemName: "もりあげねこさん", patterns: [{ patternId: 20, isHit: false }, { patternId: 21, isHit: true }] },
    { itemId: 3, itemName: "投票券", patterns: [] },
  ];

  it("分類ごとにファイルを分け、対象外（拡張子・20MB 超）は skipped に入る", () => {
    const plan = planPackImport(files, items);
    expect(plan.categories.fireworks).toEqual([0, 1]);
    expect(plan.categories.cat).toEqual([2]);
    expect(plan.categories[PACK_GENERIC]).toEqual([3]);
    expect(plan.categories[PACK_HIT]).toEqual([4]);
    expect(plan.categories["bulk-MIRACLE"]).toEqual([5]);
    expect(plan.skipped.map((s) => s.index)).toEqual([6, 7]);
  });

  it("アイテムのテーマの音を item:{id}（#2〜）に、当たりに pattern:{id}、段階に bulk:{段階} を割り当てる", () => {
    const plan = planPackImport(files, items);
    const keys = (prefix: string) => plan.assignments.filter((a) => a.key.startsWith(prefix)).map((a) => [a.key, a.fileIndex]);
    // 花火: 2 本とも（順序は id で回る）
    expect(keys("item:1").map(([, i]) => i).sort()).toEqual([0, 1]);
    expect(keys("item:1").map(([k]) => k)).toEqual(["item:1", "item:1#2"]);
    // ねこ: 1 本
    expect(keys("item:2")).toEqual([["item:2", 2]]);
    // テーマ無し（投票券）→ generic
    expect(keys("item:3")).toEqual([["item:3", 3]]);
    // 当たりパターン → hit の音
    expect(keys("pattern:21")).toEqual([["pattern:21", 4]]);
    expect(keys("pattern:20")).toEqual([]);
    // 段階 → bulk:MIRACLE だけ
    expect(keys("bulk:")).toEqual([["bulk:MIRACLE", 5]]);
    expect(plan.itemsAssigned).toBe(3);
    expect(plan.itemsWithoutSound).toBe(0);
    expect(plan.hitPatternsAssigned).toBe(1);
    expect(plan.bulkGradesAssigned).toBe(1);
    expect(plan.usedFiles).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("テーマの音も generic も無ければテーマ付きの音すべてから選び、それも無ければ音なしに数える", () => {
    const onlyCat = [f("p/ねこ/c.mp3")];
    const plan = planPackImport(onlyCat, items);
    // 花火のアイテムにも（generic が無いので）ねこの音が付く
    expect(plan.assignments.find((a) => a.key === "item:1")?.fileIndex).toBe(0);
    expect(plan.itemsAssigned).toBe(3);
    const onlyHit = [f("p/big_bonus.mp3")];
    const plan2 = planPackImport(onlyHit, items);
    expect(plan2.itemsAssigned).toBe(0);
    expect(plan2.itemsWithoutSound).toBe(3);
    expect(plan2.hitPatternsAssigned).toBe(1);
  });

  it("1 key は最大 5 本。同じテーマのアイテムは開始位置がずれ、同じ入力なら同じ結果", () => {
    const many = Array.from({ length: 8 }, (_, i) => f(`p/花火/${i}.mp3`));
    const twoFireworks: PackItem[] = [
      { itemId: 100, itemName: "花火" },
      { itemId: 101, itemName: "水上花火" },
    ];
    const plan = planPackImport(many, twoFireworks);
    const a = plan.assignments.filter((x) => x.key.startsWith("item:100")).map((x) => x.fileIndex);
    const b = plan.assignments.filter((x) => x.key.startsWith("item:101")).map((x) => x.fileIndex);
    expect(a).toHaveLength(5);
    expect(b).toHaveLength(5);
    expect(a).not.toEqual(b);
    expect(planPackImport(many, twoFireworks)).toEqual(plan);
  });

  it("同じ itemId が複数回来ても 1 回だけ割り当てる", () => {
    const plan = planPackImport(files, [items[0], items[0]]);
    expect(plan.assignments.filter((a) => a.key.startsWith("item:1")).length).toBe(2);
    expect(plan.itemsAssigned).toBe(1);
  });
});
