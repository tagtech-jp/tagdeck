import { describe, expect, it } from "vitest";
import { CLEARED_SOUND_IDS, CLEARED_SOUNDS, clearedSoundFor, clearedSoundLabel, clearedSoundUrl, toClearedDefaultRows, type ClearedSoundId } from "./cleared-defaults";

// 2026-09-30 時点の同期元（社長）の割り当てに使われていた音源のファイル名 21 種と、置き換え先の CC0 の音
const OBSERVED: ReadonlyArray<readonly [string, ClearedSoundId | null]> = [
  ["ポキューン！先バレ風激熱通知音.mp3", "jackpot_alert"],
  ["ゾウの鳴き声1.mp3", "elephant"],
  ["harakiridrive.mp3", "dance_jingle"],
  ["ziyagura-gako.mp3", "slot_clunk"],
  ["シャキーン2.mp3", "sparkle_shing"],
  ["狂犬が連続で吠える.mp3", "dog_bark"],
  ["x3_vol5.mp3", "pig_oink"],
  ["エアーホーン.mp3", "air_horn"],
  ["打ち上げ花火1.mp3", "fireworks"],
  ["ani_ge_cat_nya03.mp3", "cat_meow"],
  ["ドラムロール.mp3", "drumroll"],
  ["super-mario-bros-nes-music-star-theme-cut-mp3.mp3", "star_jingle"],
  ["ネズミの鳴き声1回.mp3", "mouse_squeak"],
  ["ウグイスのさえずり1.mp3", "bird_song"],
  ["ヒヨドリの鳴き声2.mp3", "bird_chirp"],
  ["「出でよ、我がしもべよ！」.mp3", "summon_magic"],
  ["d584ae8d-2137-4660-b356-9e55f22e2fb5.mp3", "deer_call"],
  // 価格帯の行で使われていた音（価格帯は配らないので、名前で決まらなくてよい）
  ["ata_a14.mp3", null],
  ["レジスターで精算.mp3", null],
];

describe("clearedSoundFor", () => {
  it.each(OBSERVED)("%s → %s", (label, id) => {
    expect(clearedSoundFor(label)).toBe(id);
  });

  it("名前で決まらない音・空は null（配らない）", () => {
    expect(clearedSoundFor("0a1b2c3d.mp3")).toBeNull();
    expect(clearedSoundFor("")).toBeNull();
    expect(clearedSoundFor(null)).toBeNull();
    // 「cat」は単語のときだけ（catch・category では当たらない）
    expect(clearedSoundFor("catch_me.mp3")).toBeNull();
    expect(clearedSoundFor("category.mp3")).toBeNull();
    // 「レジスター」「マスター」の中の「スター」は当てない
    expect(clearedSoundFor("マスターの声.mp3")).toBeNull();
    expect(clearedSoundFor("スターライト.mp3")).toBe("star_jingle");
  });

  it("同じ種類の新しいファイル名でも当たる", () => {
    expect(clearedSoundFor("ネコの鳴き声2.mp3")).toBe("cat_meow");
    expect(clearedSoundFor("Dog Bark 01.wav")).toBe("dog_bark");
    expect(clearedSoundFor("大花火.mp3")).toBe("fireworks");
    expect(clearedSoundFor("drum roll short.mp3")).toBe("drumroll");
  });
});

describe("toClearedDefaultRows", () => {
  const row = (key: string, label: string | null, extra: Partial<{ url: string | null; volume: number; enabled: boolean }> = {}) => ({
    key,
    url: "https://example.supabase.co/storage/v1/object/public/se/u/x.mp3",
    volume: 25,
    enabled: true,
    label,
    updatedAt: "2026-09-30T00:00:00Z",
    ...extra,
  });

  it("音源は同梱の CC0 の音に置き換え、ラベル・音量も置き換える（key・鳴らすはそのまま）", () => {
    const out = toClearedDefaultRows([row("item:14", "ドラムロール.mp3")]);
    expect(out).toEqual([{ key: "item:14", url: "/se/defaults/cc0/drumroll.mp3", volume: 80, enabled: true, label: "ドラムロール（CC0）", updatedAt: "2026-09-30T00:00:00Z" }]);
  });

  it("同期元のアップロード（Storage の URL）はそのまま配らない", () => {
    const out = toClearedDefaultRows(OBSERVED.map(([label], i) => row(`item:${i + 1}`, label)));
    for (const r of out) expect(r.url).toMatch(/^\/se\/defaults\/cc0\/[a-z_]+\.mp3$/);
  });

  it("価格帯（tier:*）・廃止キー・鳴らす OFF・音源なし・置き換え先の無い音は落とす", () => {
    const out = toClearedDefaultRows([
      row("tier:T4", "ポキューン！先バレ風激熱通知音.mp3"),
      row("tier:combo", "ポキューン！先バレ風激熱通知音.mp3"),
      row("tier:T2", "nc106374__【任天堂】コインの音【スーパーマリオ】.wav"),
      row("item:1", "エアーホーン.mp3", { enabled: false }),
      row("item:2", "エアーホーン.mp3", { url: null }),
      row("item:3", "0a1b2c3d.mp3"),
      row("item:13101", "ポキューン！先バレ風激熱通知音.mp3"),
    ]);
    expect(out.map((r) => r.key)).toEqual(["item:13101"]);
  });

  it("パターン・まとめ投げ・カテゴリ・変種 key は配ってよい", () => {
    const keys = ["pattern:123", "bulk:MIRACLE", "bulk:item:13098:COOL", "cat:kind:hit", "cat:group:ranking_wolf", "item:14#3"];
    const out = toClearedDefaultRows(keys.map((k) => row(k, "ドラムロール.mp3")));
    expect(out.map((r) => r.key)).toEqual(keys);
  });
});

describe("CLEARED_SOUNDS", () => {
  it("すべて同梱パス・（CC0）付きのラベル・音量 0〜100", () => {
    expect(CLEARED_SOUND_IDS.length).toBeGreaterThanOrEqual(18);
    for (const id of CLEARED_SOUND_IDS) {
      expect(clearedSoundUrl(id)).toBe(`/se/defaults/cc0/${id}.mp3`);
      expect(clearedSoundLabel(id)).toMatch(/（CC0）$/);
      expect(CLEARED_SOUNDS[id].volume).toBeGreaterThanOrEqual(0);
      expect(CLEARED_SOUNDS[id].volume).toBeLessThanOrEqual(100);
    }
  });
});
