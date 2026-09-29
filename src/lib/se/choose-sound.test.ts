import { describe, expect, it } from "vitest";
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

  it("無料でテーマがあれば lite-{テーマ}（素材 1 つの短い音。ミックスではない）", () => {
    const c = chooseSound([], t, () => 0);
    expect(c).not.toBe("disabled");
    if (c !== "disabled") {
      expect(c.key).toBe("lite-wolf");
      expect(c.theme).toBe("wolf");
      expect(c.url).toMatch(/^\/se\/lib\/lite-wolf\//);
    }
  });

  it("無料の当たり・まとめ投げも控えめ（hit / bulk のミックスにしない）", () => {
    const hit = chooseSound([], { ...t, tier: "hit", isHit: true }, () => 0);
    if (hit !== "disabled") expect(hit.key).toBe("lite-hit");
    const bulk = chooseSound([], { ...t, bulkGrade: "MIRACLE" }, () => 0);
    if (bulk !== "disabled") expect(bulk.key).toBe("lite-wolf");
  });

  it("無料でテーマが無ければカテゴリの行、それも無ければ価格帯の既定 tier-T0（控えめなポップ）", () => {
    expect(chooseSound([row("cat:group:wgp")], { ...t, itemName: "うろこ", groups: ["wgp"] })).toMatchObject({ key: "cat:group:wgp" });
    const c = chooseSound([], { ...t, itemName: "うろこ", groups: [] });
    if (c !== "disabled") expect(c.key).toBe("tier-T0");
  });

  it("自分で割り当てた個別行は無料でも優先", () => {
    expect(chooseSound([row("item:13098")], t)).toMatchObject({ key: "item:13098", source: "user" });
  });
});
