import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AUTO_LIBRARY } from "./auto-library-data";
import { baseKey, chooseSound, groupByBase, variantKeys, type SoundRow } from "./choose-sound";

const row = (key: string, url: string | null = `https://x/${key}.mp3`, enabled = true, volume = 80): SoundRow => ({ key, url, enabled, volume, label: key, source: "user" });
const seq = (...vals: number[]) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};

describe("変種 key", () => {
  it("#2〜#5 を基底にまとめる。#6 や #1 は変種ではない", () => {
    expect(baseKey("item:1#3")).toBe("item:1");
    expect(baseKey("item:1")).toBe("item:1");
    expect(baseKey("item:1#6")).toBe("item:1#6");
    expect(variantKeys("bulk:COOL")).toEqual(["bulk:COOL", "bulk:COOL#2", "bulk:COOL#3", "bulk:COOL#4", "bulk:COOL#5"]);
    expect([...groupByBase([row("item:1"), row("item:1#2"), row("tier:T1")]).keys()]).toEqual(["item:1", "tier:T1"]);
  });
});

describe("chooseSound", () => {
  const t = { patternId: 10643, itemId: 13098, itemName: "バスケット", tier: "T0" as const, isHit: false, groups: ["wolfcoming"], kind: "normal" as const };

  it("個別行（item）があればそれを使い、変種があればランダムに 1 本（鳴らす ON かつ音源ありから）", () => {
    const rows = [row("item:13098"), row("item:13098#2"), row("item:13098#3", null), row("item:13098#4", "https://x/off.mp3", false)];
    expect(chooseSound(rows, t, () => 0)).toMatchObject({ key: "item:13098", source: "user" });
    expect(chooseSound(rows, t, () => 0.99)).toMatchObject({ key: "item:13098#2" });
  });

  it("個別行が全部 OFF なら鳴らさない（自動ライブラリに落とさない）", () => {
    expect(chooseSound([row("item:13098", "https://x/a.mp3", false)], t)).toBe("disabled");
  });

  it("個別行が無く名前にテーマがあれば自動ライブラリ（一括行や tier より優先）", () => {
    const c = chooseSound([row("tier:T0"), row("cat:group:wolfcoming")], { ...t, itemName: "赤ずきんサイコロ" });
    expect(c).not.toBe("disabled");
    if (c !== "disabled") {
      expect(c.source).toBe("auto");
      expect(c.theme).toBe("wolf");
      expect(c.url).toMatch(/^\/se\/lib\/wolf\//);
    }
  });

  it("まとめ投げの段階は bulk:item → pattern → bulk → item の個別行が無ければ自動の段階セット", () => {
    const c = chooseSound([row("item:13098")], { ...t, bulkGrade: "MIRACLE" });
    expect(c).toMatchObject({ key: "item:13098" }); // item 行があるので個別行が勝つ… ただし段階 key が無い
    const c2 = chooseSound([], { ...t, bulkGrade: "MIRACLE" });
    if (c2 !== "disabled") {
      expect(c2.source).toBe("auto");
      expect(c2.key).toBe("bulk-MIRACLE");
    }
    const c3 = chooseSound([row("bulk:MIRACLE"), row("item:13098")], { ...t, bulkGrade: "MIRACLE" });
    expect(c3).toMatchObject({ key: "bulk:MIRACLE" });
  });

  it("テーマが無い名前は一括行（cat:group → cat:kind → tier）へ落ちる", () => {
    const c = chooseSound([row("tier:T0"), row("cat:kind:normal")], { ...t, itemName: "うろこ", groups: [] });
    expect(c).toMatchObject({ key: "cat:kind:normal" });
  });

  it("何も無ければ自動の価格帯既定、それも無ければ合成音", () => {
    const c = chooseSound([], { ...t, itemName: "うろこ", groups: [] });
    if (c !== "disabled") expect(c.key).toBe("tier-T0");
  });

  it("変種のランダムは渡した乱数で決まる", () => {
    const rows = [row("tier:T2"), row("tier:T2#2"), row("tier:T2#3")];
    const picks = [0, 0.4, 0.9].map((v) => chooseSound(rows, { ...t, tier: "T2", itemName: "うろこ", groups: [] }, () => v));
    expect(picks.map((p) => (p === "disabled" ? "" : p.key))).toEqual(["tier:T2", "tier:T2#2", "tier:T2#3"]);
    expect(seq(0.1)()).toBe(0.1);
  });
});

describe("chooseSound（価格帯の既定は素材ライブラリ・2026-09-29）", () => {
  const t = { patternId: null, itemId: 1, itemName: "うろこ", tier: "T2" as const, isHit: false, groups: [], kind: null };
  const def = (key: string): SoundRow => ({ key, url: "/se/defaults/old.mp3", enabled: true, volume: 80, label: "old", source: "default" });

  it("公式既定の tier 行（旧音源）は使わず、素材ライブラリの価格帯セットを鳴らす", () => {
    const c = chooseSound([def("tier:T2")], t, () => 0);
    expect(c).not.toBe("disabled");
    if (c !== "disabled") {
      expect(c.source).toBe("auto");
      expect(c.key).toBe("tier-T2");
      expect(c.url).toMatch(/^\/se\/lib\/tier-T2\//);
    }
  });

  it("自分で上げた tier 行はライブラリより優先。url null の自分の行は音量だけ反映してライブラリ", () => {
    expect(chooseSound([def("tier:T2"), row("tier:T2")], t)).toMatchObject({ key: "tier:T2", source: "user" });
    const c = chooseSound([def("tier:T2"), row("tier:T2", null, true, 30)], t);
    if (c !== "disabled") expect(c).toMatchObject({ source: "auto", volume: 30 });
    expect(chooseSound([row("tier:T2", null, false)], t)).toBe("disabled");
  });
});

describe("chooseSound（無料アイテムは控えめ・2026-09-30 社長指示「無料が派手すぎる」）", () => {
  const t = { patternId: 10643, itemId: 13098, itemName: "赤ずきんサイコロ", tier: "T0" as const, isHit: false, groups: ["wolfcoming"], kind: "normal" as const, free: true };

  it("無料でテーマがあれば lite-{落ち着いたテーマ}（素材 1 つの短い音・音量は一段小さく）。赤ずきんサイコロはオオカミではなくサイコロ", () => {
    const c = chooseSound([], t, () => 0);
    expect(c).not.toBe("disabled");
    if (c !== "disabled") {
      expect(c.key).toBe("lite-dice");
      expect(c.theme).toBe("dice");
      expect(c.url).toMatch(/^\/se\/lib\/lite-dice\//);
      expect(c.volume).toBe(65);
    }
  });

  it("無料の当たり・まとめ投げも控えめ（hit / bulk のミックスにしない）", () => {
    const hit = chooseSound([], { ...t, tier: "hit", isHit: true }, () => 0);
    if (hit !== "disabled") expect(hit).toMatchObject({ key: "lite-hit", volume: 65 });
    const bulk = chooseSound([], { ...t, bulkGrade: "MIRACLE" }, () => 0);
    if (bulk !== "disabled") expect(bulk.key).toBe("lite-dice");
  });

  it("有料は従来どおりミックス・音量 80", () => {
    const c = chooseSound([], { ...t, free: false, tier: "T1" }, () => 0);
    if (c !== "disabled") expect(c).toMatchObject({ key: "wolf", volume: 80 });
  });

  it("無料でテーマが無ければカテゴリの行、それも無ければ価格帯の既定 tier-T0（控えめなポップ）", () => {
    expect(chooseSound([row("cat:group:wgp")], { ...t, itemName: "うろこ", groups: ["wgp"] })).toMatchObject({ key: "cat:group:wgp" });
    const c = chooseSound([], { ...t, itemName: "うろこ", groups: [] });
    if (c !== "disabled") expect(c).toMatchObject({ key: "tier-T0", volume: 65 });
    // 名前で決まらなければイベントのカテゴリ（wolfcoming）から（バスケット → オオカミの単発音）
    const basket = chooseSound([], { ...t, itemName: "バスケット" }, () => 0);
    if (basket !== "disabled") expect(basket.key).toBe("lite-wolf");
  });

  it("自分で割り当てた個別行は無料でも優先", () => {
    expect(chooseSound([row("item:13098")], t)).toMatchObject({ key: "item:13098", source: "user" });
  });
});

describe("chooseSound（¥160 以上は 5 秒以上の豪華なミックス・イベントアイテムと花火の段階・S25）", () => {
  // 公式既定・社長の行（S23/S24 で置き換えた CC0 の単発音）
  const cleared = (key: string, id: string, volume = 80, enabled = true): SoundRow => ({ key, url: `/se/defaults/cc0/${id}.mp3`, enabled, volume, label: id, source: "default" });
  const pig = { patternId: 1, itemId: 10842, itemName: "トンでもない応援をするぶたさん", tier: "T1" as const, isHit: false, groups: ["wolfcoming"], kind: "normal" as const, free: false, unitPriceYen: 160 };
  const secondsOf = (url: string | null) => {
    const m = /^\/se\/lib\/([^/]+)\/([^/]+)\.mp3$/.exec(url ?? "");
    return m ? AUTO_LIBRARY[m[1]]?.find((f) => f.file === url)?.seconds ?? 0 : 0;
  };

  it("¥160 のイベントアイテムは既定の単発音（ぶたの鳴き声 0.7 秒）ではなく、テーマのミックス（5 秒以上）。音量は行の音量", () => {
    const c = chooseSound([cleared("item:10842", "pig_oink", 70)], pig, () => 0);
    expect(c).not.toBe("disabled");
    if (c !== "disabled") {
      expect(c).toMatchObject({ source: "auto", key: "pig", theme: "pig", volume: 70 });
      expect(secondsOf(c.url)).toBeGreaterThanOrEqual(5);
    }
  });

  it("¥160 未満の有料アイテムは既定の単発音のまま（風船 ¥1 のエアホーン）", () => {
    expect(chooseSound([cleared("item:1", "air_horn")], { ...pig, itemId: 1, itemName: "風船", unitPriceYen: 1 })).toMatchObject({ key: "item:1", source: "default" });
  });

  it("まとめ投げの段階は既定の単発音より段階のミックス。主要なイベントアイテムは専用の長いミックス ev-{テーマ}-{段階}", () => {
    for (const grade of ["COOL", "GREAT", "FANTASTIC", "MIRACLE"] as const) {
      const c = chooseSound([cleared("item:10842", "pig_oink")], { ...pig, tier: "T3", bulkGrade: grade }, () => 0);
      if (c === "disabled") throw new Error("disabled");
      expect(c.key).toBe(`ev-pig-${grade}`);
    }
    const len = (g: "COOL" | "MIRACLE") => Math.min(...AUTO_LIBRARY[`ev-pig-${g}`].map((f) => f.seconds));
    expect(len("MIRACLE")).toBeGreaterThan(len("COOL"));
    // 共通の段階セットより長い（まとめ投げごとにさらに長く）
    expect(Math.min(...AUTO_LIBRARY["ev-pig-COOL"].map((f) => f.seconds))).toBeGreaterThan(Math.max(...AUTO_LIBRARY["pig"].map((f) => f.seconds)));
    // 安いアイテムの段階も既定の単発音ではなく共通の段階セット
    const balloon = chooseSound([cleared("item:1", "air_horn")], { ...pig, itemId: 1, itemName: "風船", unitPriceYen: 1, tier: "T0", bulkGrade: "COOL" }, () => 0);
    if (balloon !== "disabled") expect(balloon.key).toBe("bulk-COOL");
  });

  it("花火は値段にかかわらず花火ショー（既定の単発音 4 秒ではなく fireworks のミックス）。段階は ev-fireworks-*", () => {
    const fw = { ...pig, itemId: 5, itemName: "花火", unitPriceYen: 1100, tier: "T2" as const, groups: [] };
    const c = chooseSound([cleared("item:5", "fireworks")], fw, () => 0);
    if (c === "disabled") throw new Error("disabled");
    expect(c.key).toBe("fireworks");
    expect(secondsOf(c.url)).toBeGreaterThanOrEqual(8);
    const cheap = chooseSound([cleared("item:5", "fireworks")], { ...fw, unitPriceYen: 100, tier: "T1" }, () => 0);
    if (cheap !== "disabled") expect(cheap.key).toBe("fireworks");
    const m = chooseSound([cleared("item:5", "fireworks")], { ...fw, bulkGrade: "MIRACLE" }, () => 0);
    if (m !== "disabled") expect(m.key).toBe("ev-fireworks-MIRACLE");
  });

  it("自分でアップロードした音源の行は ¥160 以上・段階でも最優先。鳴らす OFF の既定行は鳴らさない", () => {
    expect(chooseSound([row("item:10842")], pig)).toMatchObject({ key: "item:10842", source: "user" });
    expect(chooseSound([row("item:10842")], { ...pig, bulkGrade: "MIRACLE" })).toMatchObject({ key: "item:10842", source: "user" });
    expect(chooseSound([cleared("item:10842", "pig_oink", 80, false)], pig)).toBe("disabled");
  });

  it("無料アイテムは既定の単発音のまま（控えめ）", () => {
    expect(chooseSound([cleared("item:13100", "summon_magic")], { ...pig, itemId: 13100, itemName: "おばあさんたぬっち", free: true, unitPriceYen: 0 })).toMatchObject({ key: "item:13100", source: "default" });
  });

  it("¥160 以上でテーマのミックスが短い（レベル 1）テーマは豪華版 p-{テーマ}、テーマなしは価格帯 T2 以上", () => {
    const food = chooseSound([], { ...pig, itemId: 999, itemName: "月見ハンバーガー", groups: [], unitPriceYen: 300 }, () => 0);
    if (food === "disabled") throw new Error("disabled");
    expect(food.key).toBe("p-food");
    expect(secondsOf(food.url)).toBeGreaterThanOrEqual(5);
    const cheapFood = chooseSound([], { ...pig, itemId: 999, itemName: "月見ハンバーガー", groups: [], unitPriceYen: 30 }, () => 0);
    if (cheapFood !== "disabled") expect(cheapFood.key).toBe("food");
    const none = chooseSound([], { ...pig, itemId: 998, itemName: "うろこ", groups: [], unitPriceYen: 160, tier: "T1" }, () => 0);
    if (none !== "disabled") expect(none.key).toBe("tier-T2");
  });

  it("おばあさんたぬっち・もぐらさん・シカさんは専用テーマ（ぽんぽこ・もぐら・シカ）", () => {
    for (const [itemId, itemName, theme, cid] of [
      [13100, "おばあさんたぬっち", "tanuki", "summon_magic"],
      [12132, "もぐりながら応援するもぐらさん", "mole", "sparkle_shing"],
      [12131, "たしかな応援をするシカさん", "deer", "deer_call"],
    ] as const) {
      const c = chooseSound([cleared(`item:${itemId}`, cid)], { ...pig, itemId, itemName }, () => 0);
      if (c === "disabled") throw new Error("disabled");
      expect(c.key).toBe(theme);
      expect(secondsOf(c.url)).toBeGreaterThanOrEqual(5);
      const b = chooseSound([cleared(`item:${itemId}`, cid)], { ...pig, itemId, itemName, bulkGrade: "GREAT" }, () => 0);
      if (b !== "disabled") expect(b.key).toBe(`ev-${theme}-GREAT`);
    }
  });
});

describe("chooseSound（ギンギラギンギャラクシーオーロラ・2026-09-30 社長指示「音が悲しい」）", () => {
  it("¥1,000 のオーロラは既定の単発音（きらめきのジングル）ではなく、オーロラ・銀河のミックス（明るいきらめき・5 秒以上）", () => {
    const row: SoundRow = { key: "item:13064", url: "/se/defaults/cc0/star_jingle.mp3", enabled: true, volume: 80, label: "star_jingle", source: "default" };
    const c = chooseSound([row], { patternId: 1, itemId: 13064, itemName: "ギンギラギンギャラクシーオーロラ", tier: "T2", isHit: false, groups: ["gingiragin"], kind: "normal", free: false, unitPriceYen: 1000 }, () => 0);
    if (c === "disabled") throw new Error("disabled");
    expect(c).toMatchObject({ source: "auto", key: "aurora", theme: "aurora" });
    const f = AUTO_LIBRARY["aurora"].find((x) => x.file === c.url);
    expect(f?.seconds ?? 0).toBeGreaterThanOrEqual(5);
    // 悲しく聞こえた 8 ビットのジングル（jingles_NES00）は、どのミックスにも公式既定にも入っていない
    const lib = JSON.parse(readFileSync(path.resolve(__dirname, "../../../public/se/lib/manifest.json"), "utf8")) as { themes: Record<string, Array<{ components: Array<{ id: string }> }>> };
    const defs = JSON.parse(readFileSync(path.resolve(__dirname, "../../../public/se/defaults/cc0/defaults.json"), "utf8")) as { sounds: Record<string, { components: Array<{ id: string }> }> };
    const ids = [...Object.values(lib.themes).flatMap((rows) => rows.flatMap((r) => r.components.map((c) => c.id))), ...Object.values(defs.sounds).flatMap((d) => d.components.map((c) => c.id))];
    expect(ids.length).toBeGreaterThan(100);
    expect(ids.filter((id) => id.includes("jingles_NES00"))).toEqual([]);
  });
});
