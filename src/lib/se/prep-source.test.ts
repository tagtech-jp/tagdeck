import { describe, expect, it } from "vitest";
import { PACK_GENERIC } from "./pack-import";
import { ffmpegPrepArgs, parseCutsCsv, parseCutsJson, parseTimecode, planPrep, sanitizeName, themeForSource } from "./prep-source";

describe("parseTimecode（秒・mm:ss・hh:mm:ss）", () => {
  it.each([
    ["83", 83],
    ["83.5", 83.5],
    ["1:23.5", 83.5],
    ["01:23", 83],
    ["1:02:03.25", 3723.25],
    [" 0 ", 0],
  ])("%s → %s 秒", (text, sec) => {
    expect(parseTimecode(text)).toBeCloseTo(sec, 6);
  });

  it.each(["", "abc", "1:2:3:4", "-5", "1:-2", "1m23s", "1:23:"])("不正な %s は例外", (text) => {
    expect(() => parseTimecode(text)).toThrow(/時刻の形が不正/);
  });
});

describe("sanitizeName（ファイル名に使えない文字）", () => {
  it("区切りや記号は _ に、空白は 1 つに、先頭の . は外す", () => {
    const s = sanitizeName('  a/b:c*?"<>|  d  ');
    expect(s).not.toMatch(/[\\/:*?"<>|]/);
    expect(s).toBe("a_b_c______ d");
    expect(sanitizeName("..hidden")).toBe("hidden");
  });
  it("空なら clip", () => {
    expect(sanitizeName("   ")).toBe("clip");
    expect(sanitizeName("")).toBe("clip");
  });
});

describe("parseCutsCsv", () => {
  it("BOM・CRLF・コメント・引用符・列の順の違いに対応し、end 空は末尾まで", () => {
    const text = '﻿name,file,start,end,theme\r\n# コメント\r\n北斗_確定,"北斗, 録画.mp4",1:23.5,1:26,確定\r\n,北斗_録画.mp4,2:10,,\r\n';
    const cuts = parseCutsCsv(text);
    expect(cuts).toEqual([
      { file: "北斗, 録画.mp4", start: 83.5, end: 86, name: "北斗_確定", theme: "確定" },
      { file: "北斗_録画.mp4", start: 130, end: null, name: null, theme: null },
    ]);
  });
  it("空文字は 0 件", () => {
    expect(parseCutsCsv("")).toEqual([]);
  });
  it("見出しに file / start が無ければ例外", () => {
    expect(() => parseCutsCsv("a,b\nx,y\n")).toThrow(/見出し/);
  });
  it("end が start 以下なら例外、file が空なら例外", () => {
    expect(() => parseCutsCsv("file,start,end\nx.mp4,10,10\n")).toThrow(/start 以下/);
    expect(() => parseCutsCsv("file,start,end\n,10,20\n")).toThrow(/file が空/);
  });
});

describe("parseCutsJson", () => {
  it("数値と mm:ss の両方を受け、name / theme は省略可", () => {
    const cuts = parseCutsJson('[{"file":"a.mp4","start":"1:00","end":65,"name":"キュイン","theme":"確定"},{"file":"b.mp4"}]');
    expect(cuts).toEqual([
      { file: "a.mp4", start: 60, end: 65, name: "キュイン", theme: "確定" },
      { file: "b.mp4", start: 0, end: null, name: null, theme: null },
    ]);
  });
  it("配列でない・file が空・end が start 以下 は例外", () => {
    expect(() => parseCutsJson("{}")).toThrow(/配列/);
    expect(() => parseCutsJson('[{"start":1}]')).toThrow(/file が空/);
    expect(() => parseCutsJson('[{"file":"a.mp4","start":5,"end":5}]')).toThrow(/start 以下/);
  });
});

describe("themeForSource（map.json の言葉 → テーマ）", () => {
  it("大小文字を区別せず、長い言葉を優先する。空の言葉は無視", () => {
    const map = { play: "リーチ", "play_big": "大当たり", "": "x", "  ": "y" };
    expect(themeForSource("rec/PLAY_BIG_01.mp4", map)).toBe("大当たり");
    expect(themeForSource("rec/play_01.mp4", map)).toBe("リーチ");
    expect(themeForSource("rec/other.mp4", map)).toBeNull();
  });
});

describe("planPrep（計画）", () => {
  const sources = ["rec/北斗_録画.mp4", "play_video.mp4", "misc/zzz_qqq.wav"];
  const map = { play: "リーチ" };

  it("cuts は {テーマ}/{名前}.wav、cuts の無い元ファイルは丸ごと。分類は se:pack と同じ", () => {
    const { jobs, warnings } = planPrep(
      sources,
      [
        { file: "北斗_録画.mp4", start: 83.5, end: 86, name: "北斗_確定", theme: "確定" },
        { file: "北斗_録画", start: 130, end: null, name: "激アツ_先読み", theme: null },
      ],
      map,
    );
    expect(jobs).toEqual([
      { src: "rec/北斗_録画.mp4", start: 83.5, end: 86, out: "確定/北斗_確定.wav", category: "jackpot" },
      { src: "rec/北斗_録画.mp4", start: 130, end: null, out: "激アツ_先読み.wav", category: "epic" },
      { src: "play_video.mp4", start: null, end: null, out: "リーチ/play_video.wav", category: "casino" },
      { src: "misc/zzz_qqq.wav", start: null, end: null, out: "zzz_qqq.wav", category: PACK_GENERIC },
    ]);
    expect(warnings).toEqual([expect.stringContaining("分類なし: zzz_qqq.wav")]);
  });

  it("名前の無い cut は 元の名前_開始時刻、同じ出力名は _2 で分ける", () => {
    const { jobs } = planPrep(
      ["a.mp4"],
      [
        { file: "a.mp4", start: 130, end: 131, name: null, theme: "確定" },
        { file: "a.mp4", start: 0, end: 1, name: "x", theme: "確定" },
        { file: "A.MP4", start: 1, end: 2, name: "x", theme: "確定" },
      ],
      {},
    );
    expect(jobs.map((j) => j.out)).toEqual(["確定/a_02m10.0s.wav", "確定/x.wav", "確定/x_2.wav"]);
  });

  it("当たらない file と、同じ名前が複数ある file は警告して飛ばす", () => {
    const { jobs, warnings } = planPrep(
      ["a/x.mp4", "b/x.mp4"],
      [
        { file: "x.mp4", start: 0, end: 1, name: "確定", theme: null },
        { file: "nothere.mp4", start: 0, end: 1, name: "確定", theme: null },
        { file: "b/x.mp4", start: 0, end: 1, name: "リーチ", theme: null },
      ],
      {},
      { onlyCuts: true },
    );
    expect(jobs).toEqual([{ src: "b/x.mp4", start: 0, end: 1, out: "リーチ.wav", category: "casino" }]);
    expect(warnings).toEqual([expect.stringContaining('"x.mp4" に当たる元ファイルが 2 件'), expect.stringContaining('"nothere.mp4" に当たる元ファイルがありません')]);
  });

  it("onlyCuts なら cuts の無い元ファイルは置かない", () => {
    const { jobs } = planPrep(sources, [{ file: "play_video.mp4", start: 0, end: 2, name: "リーチ_01", theme: null }], map, { onlyCuts: true });
    expect(jobs.map((j) => j.out)).toEqual(["リーチ/リーチ_01.wav"]);
  });
});

describe("ffmpegPrepArgs", () => {
  it("区間あり: -ss を -i の前に、長さは -t。wav mono 44.1kHz", () => {
    const args = ffmpegPrepArgs("in.mp4", "out.wav", 83.5, 86);
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
    expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 4)).toEqual(["-ss", "83.5", "-t", "2.5"]);
    expect(args).toEqual(expect.arrayContaining(["-vn", "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le"]));
    expect(args[args.length - 1]).toBe("out.wav");
  });
  it("区間なし: -ss も -t も付けない。start だけなら -t は付けない", () => {
    expect(ffmpegPrepArgs("in.mp4", "out.wav", null, null)).not.toEqual(expect.arrayContaining(["-ss"]));
    const only = ffmpegPrepArgs("in.mp4", "out.wav", 10, null);
    expect(only).toEqual(expect.arrayContaining(["-ss", "10"]));
    expect(only).not.toEqual(expect.arrayContaining(["-t"]));
  });
});
