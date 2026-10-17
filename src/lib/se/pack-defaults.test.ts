import { describe, expect, it } from "vitest";
import { DEFAULT_SE_MAPPINGS } from "./default-mappings";
import { isPackUrl, substitutePackRows } from "./pack-defaults";

const PACK = "https://example.supabase.co/storage/v1/object/public/se/00000000-0000-4000-8000-000000000000/pack/abcdef123456_確定_01.mp3";
const snapshot = [{ key: "item:1", url: "/se/defaults/cc0/fireworks.mp3", volume: 80, label: "打ち上げ花火（CC0）" }];

describe("isPackUrl", () => {
  it.each([
    [PACK, true],
    ["/se/defaults/cc0/fireworks.mp3", false],
    ["https://example.supabase.co/storage/v1/object/public/se/uid/upload/a.mp3", false],
    [null, false],
    [undefined, false],
    ["", false],
  ])("%s → %s", (url, want) => {
    expect(isPackUrl(url)).toBe(want);
  });
});

describe("substitutePackRows（公式既定からパック由来の行を外す）", () => {
  it("パック由来の行はスナップショットの同じ key に置き換え、無ければ外す。それ以外の行と順序はそのまま", () => {
    const rows = [
      { key: "item:1", url: PACK, volume: 80, enabled: true, label: "確定_01", updatedAt: "t1" },
      { key: "item:1#2", url: PACK, volume: 80, enabled: true, label: "確定_02", updatedAt: "t2" },
      { key: "item:2", url: "/se/defaults/cc0/cat_meow.mp3", volume: 70, enabled: true, label: "ねこの鳴き声（CC0）", updatedAt: "t3" },
      { key: "item:3", url: PACK, volume: 80, enabled: true, label: "確定_03", updatedAt: "t4" },
      { key: "bulk:MIRACLE", url: "https://example.supabase.co/storage/v1/object/public/se/uid/upload/m.mp3", volume: 90, enabled: true, label: "手で上げた音", updatedAt: "t5" },
    ];
    expect(substitutePackRows(rows, snapshot)).toEqual([
      { key: "item:1", url: "/se/defaults/cc0/fireworks.mp3", volume: 80, enabled: true, label: "打ち上げ花火（CC0）", updatedAt: "t1" },
      { key: "item:2", url: "/se/defaults/cc0/cat_meow.mp3", volume: 70, enabled: true, label: "ねこの鳴き声（CC0）", updatedAt: "t3" },
      { key: "bulk:MIRACLE", url: "https://example.supabase.co/storage/v1/object/public/se/uid/upload/m.mp3", volume: 90, enabled: true, label: "手で上げた音", updatedAt: "t5" },
    ]);
  });

  it("パックの行が無ければ入力と同じ", () => {
    const rows = [{ key: "item:9", url: "/se/defaults/cc0/coin.mp3", volume: 80, enabled: true, label: "コイン（CC0）" }];
    expect(substitutePackRows(rows, snapshot)).toEqual(rows);
  });

  it("同梱スナップショット（default-mappings.ts）の行で代用できる（スナップショットの key がパックで上書きされた場合）", () => {
    const first = DEFAULT_SE_MAPPINGS[0];
    const rows = [{ key: first.key, url: PACK, volume: 80, enabled: true, label: "パックの音" }];
    expect(substitutePackRows(rows, DEFAULT_SE_MAPPINGS)).toEqual([{ key: first.key, url: first.url, volume: first.volume, enabled: true, label: first.label }]);
    expect(first.url).toMatch(/^\/se\/defaults\/cc0\//);
  });
});
