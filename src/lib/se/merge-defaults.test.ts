import { describe, expect, it } from "vitest";
import { DEFAULT_SE_MAPPINGS } from "./default-mappings";
import { hasDefaultSound, mergeWithDefaults } from "./merge-defaults";

/** /api/se/mappings と同じ key 書式 */
const SE_KEY_RE = /^(pattern:\d{1,10}|item:\d{1,10}|cat:kind:(normal|hit|anim)|cat:group:[A-Za-z0-9_#-]{1,64}|tier:(T0|T1|T2|T3|T4|hit))$/;

const DEFAULTS = [
  { key: "tier:T1", url: "/se/defaults/a.mp3", volume: 80, label: "a" },
  { key: "item:5", url: "/se/defaults/b.mp3", volume: 100, label: "b" },
];

describe("mergeWithDefaults", () => {
  it("ユーザー行が無い key は既定（source=default）", () => {
    const out = mergeWithDefaults([], DEFAULTS);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ key: "tier:T1", url: "/se/defaults/a.mp3", volume: 80, enabled: true, source: "default", usesDefaultSound: true });
  });
  it("ユーザーが音源を上げた key はユーザー行を使う", () => {
    const out = mergeWithDefaults([{ key: "tier:T1", url: "https://x/u.mp3", volume: 50, enabled: true, label: "u" }], DEFAULTS);
    expect(out.find((m) => m.key === "tier:T1")).toMatchObject({ url: "https://x/u.mp3", volume: 50, label: "u", source: "user", usesDefaultSound: false });
  });
  it("音量・鳴らすだけ変えた行（url null）は音源が既定のまま", () => {
    const out = mergeWithDefaults([{ key: "item:5", url: null, volume: 30, enabled: false }], DEFAULTS);
    expect(out.find((m) => m.key === "item:5")).toMatchObject({ url: "/se/defaults/b.mp3", volume: 30, enabled: false, label: "b", source: "user", usesDefaultSound: true });
  });
  it("既定に無い key は従来どおり（url null なら合成音）", () => {
    const out = mergeWithDefaults([{ key: "tier:T4", url: null, volume: 80, enabled: true }], DEFAULTS);
    expect(out.find((m) => m.key === "tier:T4")).toMatchObject({ url: null, source: "user", usesDefaultSound: false });
  });
  it("hasDefaultSound", () => {
    expect(hasDefaultSound("tier:T1", DEFAULTS)).toBe(true);
    expect(hasDefaultSound("tier:T2", DEFAULTS)).toBe(false);
  });
});

describe("DEFAULT_SE_MAPPINGS（同梱データ）", () => {
  it("key は書式どおりで重複なし、url は同梱パス、volume は 0〜100", () => {
    const keys = DEFAULT_SE_MAPPINGS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of DEFAULT_SE_MAPPINGS) {
      expect(d.key).toMatch(SE_KEY_RE);
      expect(d.url).toMatch(/^\/se\/defaults\/[A-Za-z0-9_.-]+\.(mp3|ogg|wav)$/);
      expect(d.volume).toBeGreaterThanOrEqual(0);
      expect(d.volume).toBeLessThanOrEqual(100);
    }
  });
  it("第三者の著作物と思われる音源は既定に含めない（T2 コイン音・item:13064 牙狼）", () => {
    expect(DEFAULT_SE_MAPPINGS.find((d) => d.key === "tier:T2")).toBeUndefined();
    expect(DEFAULT_SE_MAPPINGS.find((d) => d.key === "item:13064")).toBeUndefined();
    expect(DEFAULT_SE_MAPPINGS.some((d) => /任天堂|ガロ/.test(d.label))).toBe(false);
  });
});
