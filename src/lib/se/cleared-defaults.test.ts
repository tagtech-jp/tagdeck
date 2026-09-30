import { describe, expect, it } from "vitest";
import { CLEARED_SOUND_IDS, CLEARED_SOUNDS, clearedIdFromUrl, clearedSoundFor, clearedSoundLabel, clearedSoundUrl, planOwnCc0Conversion, toClearedDefaultRows, type ClearedSoundId } from "./cleared-defaults";
import { DEFAULT_SE_MAPPINGS } from "./default-mappings";

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

describe("CC0 に置き換え済みの行（S24）", () => {
  it("CC0 のラベルからも同じ種類に戻る（同期元が置き換え済みでも他の利用者に同じ音を配れる）", () => {
    for (const id of CLEARED_SOUND_IDS) expect(clearedSoundFor(clearedSoundLabel(id)), id).toBe(id);
  });

  it("clearedIdFromUrl は同梱の CC0 の音の URL だけ種類を返す", () => {
    expect(clearedIdFromUrl("/se/defaults/cc0/drumroll.mp3")).toBe("drumroll");
    expect(clearedIdFromUrl("/se/defaults/cc0/unknown.mp3")).toBeNull();
    expect(clearedIdFromUrl("/se/defaults/drumroll.mp3")).toBeNull();
    expect(clearedIdFromUrl("https://x.supabase.co/storage/v1/object/public/se/u/drumroll.mp3")).toBeNull();
    expect(clearedIdFromUrl(null)).toBeNull();
  });

  it("toClearedDefaultRows は置き換え済みの行を URL から判定する（ラベルが何でも同じ音）", () => {
    const out = toClearedDefaultRows([{ key: "item:14", url: "/se/defaults/cc0/drumroll.mp3", volume: 80, enabled: true, label: "何でもよい" }]);
    expect(out).toEqual([{ key: "item:14", url: "/se/defaults/cc0/drumroll.mp3", volume: 80, enabled: true, label: "ドラムロール（CC0）" }]);
  });
});

describe("planOwnCc0Conversion（自分の割り当てを CC0 だけに・S24）", () => {
  const up = (key: string, label: string | null) => ({ key, url: `https://x.supabase.co/storage/v1/object/public/se/u/${encodeURIComponent(label ?? "x")}`, volume: 25, enabled: true, label });

  it("アップロードの行は CC0 の同種の音へ、価格帯・廃止キー・分からない音は外し、音源なし・同梱の行はそのまま", () => {
    const plan = planOwnCc0Conversion([
      up("item:14", "ドラムロール.mp3"),
      up("tier:T2", "nc106374__【任天堂】コインの音【スーパーマリオ】.wav"),
      up("tier:combo", "ポキューン！先バレ風激熱通知音.mp3"),
      up("item:999", "0a1b2c3d.mp3"),
      { key: "item:5", url: null, volume: 30, enabled: true, label: null },
      { key: "item:6", url: "/se/defaults/cc0/fireworks.mp3", volume: 80, enabled: true, label: "打ち上げ花火（CC0）" },
      { ...up("item:10773", "ゾウの鳴き声1.mp3"), enabled: false },
    ]);
    expect(plan.updates).toEqual([
      { key: "item:14", url: "/se/defaults/cc0/drumroll.mp3", label: "ドラムロール（CC0）", volume: 80, from: "ドラムロール.mp3" },
      // 鳴らす OFF の行も音源は CC0 に置き換える（ON/OFF はそのまま）
      { key: "item:10773", url: "/se/defaults/cc0/elephant.mp3", label: "ゾウの鳴き声（CC0）", volume: 80, from: "ゾウの鳴き声1.mp3" },
    ]);
    expect(plan.deletes.map((d) => d.key)).toEqual(["tier:T2", "tier:combo", "item:999"]);
    expect(plan.kept).toEqual(["item:5", "item:6"]);
  });

  it("2026-09-30 時点の社長の割り当て（アイテム 75 件 + 価格帯 6 件）は、75 件を CC0 に置き換えて 6 件を外す", () => {
    const labelOf = (url: string) =>
      ({
        drumroll: "ドラムロール.mp3", elephant: "ゾウの鳴き声1.mp3", dog_bark: "狂犬が連続で吠える.mp3", pig_oink: "x3_vol5.mp3", fireworks: "打ち上げ花火1.mp3",
        air_horn: "エアーホーン.mp3", cat_meow: "ani_ge_cat_nya03.mp3", mouse_squeak: "ネズミの鳴き声1回.mp3", bird_song: "ウグイスのさえずり1.mp3", bird_chirp: "ヒヨドリの鳴き声2.mp3",
        sparkle_shing: "シャキーン2.mp3", jackpot_alert: "ポキューン！先バレ風激熱通知音.mp3", slot_clunk: "ziyagura-gako.mp3", dance_jingle: "harakiridrive.mp3",
        star_jingle: "super-mario-bros-nes-music-star-theme-cut-mp3.mp3", summon_magic: "「出でよ、我がしもべよ！」.mp3", deer_call: "d584ae8d-2137-4660-b356-9e55f22e2fb5.mp3",
      })[clearedIdFromUrl(url) as string] ?? "";
    const rows = [
      ...DEFAULT_SE_MAPPINGS.map((d) => up(d.key, labelOf(d.url))),
      up("tier:T0", "クイズ正解1.mp3"),
      up("tier:T1", "ata_a14.mp3"),
      up("tier:T2", "nc106374__【任天堂】コインの音【スーパーマリオ】.wav"),
      up("tier:T3", "レジスターで精算.mp3"),
      up("tier:T4", "ポキューン！先バレ風激熱通知音.mp3"),
      up("tier:combo", "ポキューン！先バレ風激熱通知音.mp3"),
    ];
    const plan = planOwnCc0Conversion(rows);
    expect(plan.updates).toHaveLength(75);
    expect(plan.deletes.map((d) => d.key).sort()).toEqual(["tier:T0", "tier:T1", "tier:T2", "tier:T3", "tier:T4", "tier:combo"]);
    // 置き換え後の音は、他の利用者に配っている公式既定（同梱スナップショット）と同じ
    const byKey = new Map(DEFAULT_SE_MAPPINGS.map((d) => [d.key, d.url]));
    for (const u of plan.updates) expect(u.url, u.key).toBe(byKey.get(u.key));
  });
});
