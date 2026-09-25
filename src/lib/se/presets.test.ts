import { describe, expect, it } from "vitest";
import {
  SHARE_CODE_RE,
  buildShareUrl,
  generateShareCode,
  mergeMappings,
  normalizeShareCode,
  summarizeMappings,
  toPresetMappings,
  type SePresetMapping,
} from "./presets";

describe("generateShareCode / normalizeShareCode", () => {
  it("8 文字・紛らわしい文字を含まない", () => {
    for (let i = 0; i < 50; i++) {
      const c = generateShareCode();
      expect(c).toMatch(SHARE_CODE_RE);
      expect(c).not.toMatch(/[IO01]/);
    }
  });
  it("決定的な乱数から同じコードを作る", () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(generateShareCode(bytes)).toBe("ABCDEFGH");
  });
  it("小文字・空白・ハイフン・共有 URL を受け付け、書式外は null", () => {
    expect(normalizeShareCode(" abcd-efgh ")).toBe("ABCDEFGH");
    expect(normalizeShareCode("https://tagdeck.jp/live?sePreset=ABCDEFGH&x=1")).toBe("ABCDEFGH");
    expect(normalizeShareCode("ABCDEFG")).toBeNull(); // 7 文字
    expect(normalizeShareCode("ABCDEFG0")).toBeNull(); // 0 は使わない
    expect(normalizeShareCode("")).toBeNull();
  });
  it("共有 URL を組み立てる", () => {
    expect(buildShareUrl("https://tagdeck.jp/", "ABCDEFGH")).toBe("https://tagdeck.jp/live?sePreset=ABCDEFGH");
  });
});

describe("toPresetMappings", () => {
  const host = "example.supabase.co";
  it("書式外の key・重複・他ホストの URL を落とし、volume を丸める", () => {
    const rows = [
      { key: "tier:T1", url: `https://${host}/storage/v1/object/public/se/u/a.mp3`, volume: 120, enabled: true, label: "a.mp3" },
      { key: "tier:T1", url: null, volume: 10, enabled: false, label: null }, // 重複 → 先勝ち
      { key: "item:123", url: "https://evil.example.com/x.mp3", volume: 50.6, enabled: false, label: "x" },
      { key: "bogus", url: null, volume: 1, enabled: true, label: null },
      { key: "cat:group:stage_up_pack#ouen-buta", volume: -5 },
      null,
    ];
    const out = toPresetMappings(rows, { allowedHost: host });
    expect(out).toEqual([
      { key: "tier:T1", url: `https://${host}/storage/v1/object/public/se/u/a.mp3`, volume: 100, enabled: true, label: "a.mp3" },
      { key: "item:123", url: null, volume: 51, enabled: false, label: "x" },
      { key: "cat:group:stage_up_pack#ouen-buta", url: null, volume: 0, enabled: true, label: null },
    ]);
  });
  it("配列以外は空", () => {
    expect(toPresetMappings(null)).toEqual([]);
    expect(toPresetMappings({ key: "tier:T1" })).toEqual([]);
  });
});

describe("mergeMappings / summarizeMappings", () => {
  const cur: SePresetMapping[] = [
    { key: "tier:T1", url: null, volume: 80, enabled: true, label: null },
    { key: "item:1", url: "https://x/1.mp3", volume: 70, enabled: true, label: "1" },
  ];
  const inc: SePresetMapping[] = [
    { key: "item:1", url: null, volume: 50, enabled: false, label: null },
    { key: "pattern:9", url: "https://x/9.mp3", volume: 90, enabled: true, label: "9" },
  ];
  it("replace は取り込む側だけになる", () => {
    expect(mergeMappings(cur, inc, "replace")).toEqual(inc);
  });
  it("merge は同じ key を上書きし、無い key は残す", () => {
    const out = mergeMappings(cur, inc, "merge");
    expect(out.map((m) => m.key).sort()).toEqual(["item:1", "pattern:9", "tier:T1"]);
    expect(out.find((m) => m.key === "item:1")?.volume).toBe(50);
  });
  it("内訳を数える", () => {
    expect(summarizeMappings([...cur, ...inc])).toEqual({ total: 4, tiers: 1, kinds: 0, groups: 0, items: 2, patterns: 1, customSounds: 2 });
  });
});
