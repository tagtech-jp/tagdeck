import { describe, expect, it } from "vitest";
import { AUTO_LIBRARY, AUTO_LIBRARY_CREDITS, AUTO_LIBRARY_FILE_COUNT } from "./auto-library-data";
import { bulkSetFor, bulkSetName, chooseAutoForItem, chooseAutoForTier, coreLibraryUrls, EVENT_BULK_THEMES, freeThemeFor, hasLibrarySet, isPremiumPrice, liteSetFor, pickVariant, PREMIUM_MIN_YEN, THEME_LABELS, themeForItem, themeSetFor, tierSetFor } from "./auto-library";

describe("themeForItem（アイテム名 → テーマ）", () => {
  it.each([
    ["花火", "fireworks"],
    ["ふわっち配信者の殿堂2026花火", "fireworks"],
    ["たまや〜", "fireworks"],
    ["赤ずきんダッシュサイコロ", "wolf"],
    ["トンでもない応援をするぶたさん", "pig"],
    ["イベント応援するゾウ！", "elephant"],
    ["ワンチャン33倍の応援をするワンちゃんさん", "dog"],
    // S25: 主要なイベントアイテムの専用テーマ（「たしかな」の「しか」には当てない）
    ["もぐりながら応援するもぐらさん", "mole"],
    ["たしかな応援をするシカさん", "deer"],
    ["おばあさんたぬっち", "tanuki"],
    ["チューと半端な応援をするネズミさん", "cute"],
    ["もりあげねこさん", "cat"],
    ["ギンギラギン流星群", "sparkle"],
    ["ギンギラギンギャラクシーオーロラ", "aurora"],
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
    for (const theme of Object.keys(AUTO_LIBRARY)) if (!/^(tier-|bulk-|lite-|p-|ev-|hit$)/.test(theme)) expect(THEME_LABELS[theme], theme).toBeDefined();
    // 無料アイテムの控えめな音（2026-09-30）: テーマごとの lite-* はテーマ名が THEME_LABELS にあり、1 本 3 秒未満
    for (const [set, rows] of Object.entries(AUTO_LIBRARY)) {
      if (!set.startsWith("lite-") || set === "lite-hit") continue;
      expect(THEME_LABELS[set.slice(5)], set).toBeDefined();
      for (const f of rows) expect(f.seconds, f.file).toBeLessThan(3);
    }
    for (const f of [...AUTO_LIBRARY["tier-T0"], ...AUTO_LIBRARY["lite-hit"]]) expect(f.seconds, f.file).toBeLessThan(3);
    // 無料アイテムの音（tier-T0・lite-*）は単発の短い音だけ（1.5 秒まで）
    for (const [set, rows] of Object.entries(AUTO_LIBRARY)) {
      if (set !== "tier-T0" && !set.startsWith("lite-")) continue;
      for (const f of rows) expect(f.seconds, f.file).toBeLessThanOrEqual(1.6);
    }
  });

  it("出典一覧は CC0 の素材（Freesound の音・Kenney のパック）だけで、ID・タイトル・ページがあり重複しない（S23）", () => {
    expect(AUTO_LIBRARY_CREDITS.length).toBeGreaterThan(0);
    for (const c of AUTO_LIBRARY_CREDITS) {
      expect(c.id).toMatch(/^(fs\d+|kn-[a-z0-9-]+)$/);
      expect(c.title.length, c.id).toBeGreaterThan(0);
      expect(c.page, c.id).toMatch(/^https:\/\/(freesound\.org\/people\/[^/]+\/sounds\/\d+\/|kenney\.nl\/assets\/[a-z0-9-]+)$/);
    }
    expect(new Set(AUTO_LIBRARY_CREDITS.map((c) => c.id)).size).toBe(AUTO_LIBRARY_CREDITS.length);
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
    // 花火は段階ごとの専用ミックス（S25）。専用が無いテーマは共通の bulk-{段階}
    expect(chooseAutoForItem({ itemName: "花火", tier: "T3", isHit: false, bulkGrade: "COOL" })?.set).toBe("ev-fireworks-COOL");
    expect(chooseAutoForItem({ itemName: "もりあげねこさん", tier: "T3", isHit: false, bulkGrade: "COOL" })?.set).toBe("bulk-COOL");
    expect(chooseAutoForItem({ itemName: "花火", tier: "hit", isHit: true })?.set).toBe("hit");
    expect(chooseAutoForItem({ itemName: "花火", tier: "T3", isHit: false })?.set).toBe("fireworks");
    expect(chooseAutoForItem({ itemName: "うろこ", tier: "T3", isHit: false })).toBeNull();
    expect(chooseAutoForTier("T4")?.set).toBe("tier-T4");
    expect(chooseAutoForTier("hit")?.set).toBe("hit");
    expect(bulkSetName("TAMAYA")).toBe("bulk-FANTASTIC");
  });

  it("無料アイテムは控えめ: 当たり → lite-hit、名前のテーマ → lite-{落ち着いたテーマ}、どちらも無ければ null（カテゴリ・価格帯へ）", () => {
    expect(liteSetFor("花火", null, true)).toBe("lite-hit");
    expect(liteSetFor("花火", null, false)).toBe("lite-fireworks");
    expect(liteSetFor("うろこ", null, false)).toBeNull();
    expect(liteSetFor("バスケット", ["wolfcoming"], false)).toBe("lite-wolf"); // 名前で決まらなければイベントのカテゴリから（「バス」ケットは乗り物にしない）
    expect(chooseAutoForItem({ itemName: "花火", tier: "T0", isHit: false, bulkGrade: "MIRACLE", free: true })?.set).toBe("lite-fireworks");
    expect(chooseAutoForItem({ itemName: "花火", tier: "hit", isHit: true, free: true })?.set).toBe("lite-hit");
    expect(chooseAutoForItem({ itemName: "うろこ", tier: "T0", isHit: false, free: true })).toBeNull();
    expect(chooseAutoForItem({ itemName: "花火", tier: "T3", isHit: false, free: false })?.set).toBe("fireworks");
  });

  it.each([
    // 2026-09-30 時点のイベントの無料アイテム（実データ）。アイテム名の最後に出てくる言葉のテーマ
    ["赤ずきんサイコロ", "dice"],
    ["赤ずきんダッシュサイコロ", "dice"],
    ["ジャックポットチャンス", "casino"],
    ["石油王スロット", "jackpot"],
    ["オータムチャレンジカード", "casino"],
    ["オータムチャレンジ倍率決定", "casino"],
    ["夏祭りカード", "casino"],
    ["突入", "casino"],
    ["ふわっち11周年記念花火", "fireworks"],
    ["花火", "fireworks"],
    ["11周年バルーン", "balloon"],
    ["銀のいいね！", "cheer"],
    ["銀の貯金箱", "coin"],
    ["銀のKP", "drink"],
    ["クリスタルハート", "heart"],
    ["どうぶつアイスクリーム", "food"],
    ["バスケット", null],
    ["ふわっちの絆", null],
    // 応援アイテムは動物名が最後に来る（応援 → 歓声 ではなく動物の声）
    ["イベント応援するゾウ！", "elephant"],
    ["トンでもない応援をするぶたさん", "pig"],
    ["ワンチャン33倍の応援をするワンちゃんさん", "dog"],
    ["バースデーケーキ", "food"],
    ["もりあげねこさん", "cat"],
    ["ワイン de KP", "drink"],
  ])("無料 %s → %s", (name, theme) => {
    expect(freeThemeFor(name)).toBe(theme);
    if (theme) expect(hasLibrarySet(`lite-${theme}`), theme).toBe(true);
  });

  it("coreLibraryUrls は価格帯・段階・当たりのセットから各 2 本（先読み用）", () => {
    const urls = coreLibraryUrls();
    expect(urls.length).toBe(20);
    expect(new Set(urls).size).toBe(urls.length);
    expect(coreLibraryUrls(5).length).toBeGreaterThanOrEqual(30);
  });
});

describe("豪華版・段階の専用ミックス（S25: ¥160 以上は 5 秒以上・主要なイベントアイテムと花火は段階ごとにさらに長く）", () => {
  const min = (set: string) => Math.min(...(AUTO_LIBRARY[set] ?? []).map((f) => f.seconds));
  const max = (set: string) => Math.max(...(AUTO_LIBRARY[set] ?? []).map((f) => f.seconds));

  it("isPremiumPrice は ¥160 以上だけ（無料・不明は対象外）", () => {
    expect(PREMIUM_MIN_YEN).toBe(160);
    expect(isPremiumPrice(160)).toBe(true);
    expect(isPremiumPrice(159)).toBe(false);
    expect(isPremiumPrice(0)).toBe(false);
    expect(isPremiumPrice(null)).toBe(false);
    expect(isPremiumPrice(undefined)).toBe(false);
  });

  it("有料のミックスは 5 秒以上（安いアイテム向けのレベル 1 テーマと T1 は除く。その豪華版 p-* は 5 秒以上）", () => {
    const shortOk = new Set(["tier-T0", "tier-T1", "balloon", "bird", "cute", "food", "pop", "notify", "kids", "whoosh"]);
    for (const [set, rows] of Object.entries(AUTO_LIBRARY)) {
      if (set.startsWith("lite-") || shortOk.has(set)) continue;
      for (const f of rows) expect(f.seconds, f.file).toBeGreaterThanOrEqual(5);
    }
    for (const t of ["balloon", "bird", "cute", "food", "pop", "notify", "kids", "whoosh"]) {
      expect(hasLibrarySet(`p-${t}`), t).toBe(true);
      expect(themeSetFor(t, true)).toBe(`p-${t}`);
      expect(themeSetFor(t, false)).toBe(t);
    }
    expect(themeSetFor("pig", true)).toBe("pig");
    expect(tierSetFor("T1", true)).toBe("tier-T2");
    expect(tierSetFor("T0", true)).toBe("tier-T2");
    expect(tierSetFor("T1", false)).toBe("tier-T1");
    expect(tierSetFor("T4", true)).toBe("tier-T4");
    expect(tierSetFor("hit", true)).toBe("hit");
    expect(chooseAutoForTier("T1", () => 0, true)?.set).toBe("tier-T2");
  });

  it("主要なイベントアイテムと花火は段階ごとに専用の長いミックス（COOL → MIRACLE でだんだん長く・MIRACLE は 20 秒まで）", () => {
    for (const theme of EVENT_BULK_THEMES) {
      const sets = (["COOL", "GREAT", "FANTASTIC", "MIRACLE"] as const).map((g) => `ev-${theme}-${g}`);
      for (const set of sets) {
        expect(AUTO_LIBRARY[set]?.length ?? 0, set).toBeGreaterThanOrEqual(3);
        expect(max(set), set).toBeLessThanOrEqual(20.5);
      }
      for (let i = 1; i < sets.length; i++) expect(min(sets[i]), sets[i]).toBeGreaterThan(min(sets[i - 1]));
      expect(min(sets[0]), sets[0]).toBeGreaterThan(max(theme));
      expect(bulkSetFor("COOL", theme)).toBe(`ev-${theme}-COOL`);
      expect(bulkSetFor("TAMAYA", theme)).toBe(`ev-${theme}-FANTASTIC`);
    }
    expect(bulkSetFor("MIRACLE", "cat")).toBe("bulk-MIRACLE");
    expect(bulkSetFor("MIRACLE", null)).toBe("bulk-MIRACLE");
    // 花火は 1 発でも 8 秒以上の花火ショー
    expect(min("fireworks")).toBeGreaterThanOrEqual(8);
  });

  it("新しいテーマ（たぬき・もぐら・シカ）の無料アイテムは、これまでどおり「かわいい」の単発音", () => {
    expect(liteSetFor("おばあさんたぬっち", null, false)).toBe("lite-cute");
    expect(liteSetFor("たしかな応援をするシカさん", null, false)).toBe("lite-cute");
    expect(liteSetFor("もぐりながら応援するもぐらさん", null, false)).toBe("lite-cute");
    expect(liteSetFor("ギンギラギンギャラクシーオーロラ", null, false)).toBe("lite-sparkle");
  });
});
