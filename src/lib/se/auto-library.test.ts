import { describe, expect, it } from "vitest";
import { AUTO_LIBRARY, AUTO_LIBRARY_FILE_COUNT } from "./auto-library-data";
import { bulkSetName, chooseAutoForItem, chooseAutoForTier, coreLibraryUrls, hasLibrarySet, pickVariant, THEME_LABELS, themeForItem } from "./auto-library";

describe("themeForItem（アイテム名 → テーマ）", () => {
  it.each([
    ["花火", "fireworks"],
    ["ふわっち配信者の殿堂2026花火", "fireworks"],
    ["たまや〜", "fireworks"],
    ["赤ずきんダッシュサイコロ", "wolf"],
    ["トンでもない応援をするぶたさん", "pig"],
    ["イベント応援するゾウ！", "elephant"],
    ["ワンチャン33倍の応援をするワンちゃんさん", "dog"],
    ["もぐりながら応援するもぐらさん", "cute"],
    ["たしかな応援をするシカさん", "cute"],
    ["おばあさんたぬっち", "cute"],
    ["もりあげねこさん", "cat"],
    ["ギンギラギン流星群", "sparkle"],
    ["銀の貯金箱", "coin"],
    ["金貨", "coin"],
    ["ワイン de KP", "drink"],
    ["ハート（ドキドキ）", "heart"],
    ["風船", "balloon"],
    ["メガホン", "cheer"],
    ["釣り竿", "sea"],
    ["初見です", "pop"],
    ["草", "pop"],
    ["バースデーケーキ", "party"],
    ["月見ハンバーガー", "food"],
    ["オータムリース", "flower"],
    ["石油王スロット", "jackpot"],
    ["投票券", null],
    ["うろこ", null],
  ])("%s → %s", (name, theme) => {
    expect(themeForItem(name)).toBe(theme);
  });

  it("名前で決まらなければカテゴリ key から補う", () => {
    expect(themeForItem("投票券", ["fishing_battle_v2"])).toBe("sea");
    expect(themeForItem("投票券", ["wgp"])).toBeNull();
    expect(themeForItem(null, ["word"])).toBe("pop");
  });
});

describe("自動ライブラリのデータ", () => {
  it("主要セット（価格帯・段階・当たり・主要テーマ）が 3 本以上あり、ファイルは /se/lib/ 配下", () => {
    for (const set of ["tier-T0", "tier-T1", "tier-T2", "tier-T3", "tier-T4", "hit", "bulk-COOL", "bulk-GREAT", "bulk-FANTASTIC", "bulk-MIRACLE", "fireworks", "cat", "dog", "pig", "elephant", "coin", "cheer", "sparkle", "heart", "balloon", "pop"]) {
      expect(hasLibrarySet(set), set).toBe(true);
      expect(AUTO_LIBRARY[set].length, set).toBeGreaterThanOrEqual(3);
    }
    for (const rows of Object.values(AUTO_LIBRARY)) for (const f of rows) expect(f.file).toMatch(/^\/se\/lib\/[A-Za-z0-9-]+\/[A-Za-z0-9_-]+\.mp3$/);
    expect(AUTO_LIBRARY_FILE_COUNT).toBeGreaterThan(200);
    for (const theme of Object.keys(AUTO_LIBRARY)) if (!/^(tier-|bulk-|hit$)/.test(theme)) expect(THEME_LABELS[theme], theme).toBeDefined();
  });

  it("pickVariant は同じセットで直前と同じ音を避け、1 本しか無ければそれを返す", () => {
    const files = [{ file: "a" }, { file: "b" }, { file: "c" }];
    const first = pickVariant("t", files, () => 0)!;
    const second = pickVariant("t", files, () => 0)!;
    expect(second.file).not.toBe(first.file);
    expect(pickVariant("one", [{ file: "x" }])).toEqual({ file: "x" });
    expect(pickVariant("none", [])).toBeNull();
  });

  it("chooseAutoForItem は 段階 → 当たり → テーマ の順、無ければ null。chooseAutoForTier は価格帯セット", () => {
    expect(chooseAutoForItem({ itemName: "花火", tier: "T3", isHit: false, bulkGrade: "COOL" })?.set).toBe("bulk-COOL");
    expect(chooseAutoForItem({ itemName: "花火", tier: "hit", isHit: true })?.set).toBe("hit");
    expect(chooseAutoForItem({ itemName: "花火", tier: "T3", isHit: false })?.set).toBe("fireworks");
    expect(chooseAutoForItem({ itemName: "うろこ", tier: "T3", isHit: false })).toBeNull();
    expect(chooseAutoForTier("T4")?.set).toBe("tier-T4");
    expect(chooseAutoForTier("hit")?.set).toBe("hit");
    expect(bulkSetName("TAMAYA")).toBe("bulk-FANTASTIC");
  });

  it("coreLibraryUrls は価格帯・段階・当たりのセットから各 2 本（先読み用）", () => {
    const urls = coreLibraryUrls();
    expect(urls.length).toBe(20);
    expect(new Set(urls).size).toBe(urls.length);
    expect(coreLibraryUrls(5).length).toBeGreaterThanOrEqual(30);
  });
});
