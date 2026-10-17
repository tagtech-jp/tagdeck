import { describe, expect, it } from "vitest";
import { chooseClips, clipFileName, ffmpegClipArgs, ffmpegSilenceArgs, nonSilentRanges, parseEnvFile, parseSilenceDetect } from "./pack-clip";

describe("parseSilenceDetect（ffmpeg の無音検出の出力）", () => {
  it("silence_start / silence_end の組を区間にする。末尾の開いた区間は end=Infinity", () => {
    const stderr = [
      "[silencedetect @ 0x1] silence_start: 1.5",
      "[silencedetect @ 0x1] silence_end: 2.75 | silence_duration: 1.25",
      "size=N/A time=00:00:10.00 bitrate=N/A",
      "[silencedetect @ 0x1] silence_start: 8",
    ].join("\n");
    expect(parseSilenceDetect(stderr)).toEqual([
      { start: 1.5, end: 2.75 },
      { start: 8, end: Number.POSITIVE_INFINITY },
    ]);
  });
  it("出力が無ければ空", () => {
    expect(parseSilenceDetect("")).toEqual([]);
  });
});

describe("nonSilentRanges（音のある区間）", () => {
  it("無音の補集合を [0, duration] の中で返し、短すぎるかけらは捨てる", () => {
    const r = nonSilentRanges([{ start: 1.5, end: 2.75 }, { start: 8, end: Number.POSITIVE_INFINITY }], 10);
    expect(r).toEqual([
      { start: 0, end: 1.5 },
      { start: 2.75, end: 8 },
    ]);
    expect(nonSilentRanges([{ start: 0.05, end: 9.9 }], 10)).toEqual([]);
    expect(nonSilentRanges([], 3)).toEqual([{ start: 0, end: 3 }]);
  });
});

describe("chooseClips（切り出す区間）", () => {
  const o = { minSec: 2, maxSec: 5, maxClips: 8 };
  it("候補が無ければ先頭から最大尺を 1 本", () => {
    expect(chooseClips([], 30, o)).toEqual([{ start: 0, end: 5 }]);
    expect(chooseClips([], 1.2, o)).toEqual([{ start: 0, end: 1.2 }]);
    expect(chooseClips([], 0, o)).toEqual([]);
  });
  it("長い候補は先頭から最大尺、短い候補は最小尺まで後ろに伸ばす（末尾なら前に）", () => {
    expect(chooseClips([{ start: 10, end: 30 }], 60, o)).toEqual([{ start: 10, end: 15 }]);
    expect(chooseClips([{ start: 10, end: 10.5 }], 60, o)).toEqual([{ start: 10, end: 12 }]);
    expect(chooseClips([{ start: 59, end: 59.6 }], 60, o)).toEqual([{ start: 58, end: 60 }]);
  });
  it("伸ばして重なった候補は 1 つにまとめる", () => {
    expect(chooseClips([{ start: 0, end: 0.5 }, { start: 1, end: 1.4 }], 60, o)).toEqual([{ start: 0, end: 3 }]);
  });
  it("本数が多ければ長い候補から maxClips 本（並びは時間順）", () => {
    const ranges = [
      { start: 0, end: 1 },
      { start: 5, end: 9 },
      { start: 20, end: 21 },
      { start: 30, end: 33 },
    ];
    expect(chooseClips(ranges, 60, { ...o, maxClips: 2 })).toEqual([
      { start: 5, end: 9 },
      { start: 30, end: 33 },
    ]);
  });
});

describe("ffmpeg の引数", () => {
  it("切り出し: -ss を -i の前、mono 44.1k mp3 96k、loudnorm とフェードアウト", () => {
    const args = ffmpegClipArgs("/in/a.mp4", "/out/a_01.mp3", { start: 1.25, end: 4.25 }, -14);
    expect(args.slice(0, 10)).toEqual(["-hide_banner", "-loglevel", "error", "-y", "-ss", "1.25", "-t", "3", "-i", "/in/a.mp4"]);
    expect(args).toContain("-vn");
    const af = args[args.indexOf("-af") + 1];
    expect(af).toBe("loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100,afade=t=out:st=2.88:d=0.12");
    expect(args.slice(-5)).toEqual(["-codec:a", "libmp3lame", "-b:a", "96k", "/out/a_01.mp3"]);
  });
  it("0.5 秒以下はフェードを付けない", () => {
    const af = ffmpegClipArgs("a", "b", { start: 0, end: 0.4 }, -14);
    expect(af[af.indexOf("-af") + 1]).toBe("loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100");
  });
  it("無音検出: 出力は捨てる", () => {
    const args = ffmpegSilenceArgs("/in/a.wav");
    expect(args).toEqual(["-hide_banner", "-nostats", "-i", "/in/a.wav", "-vn", "-af", "silencedetect=noise=-35dB:d=0.3", "-f", "null", "-"]);
  });
});

describe("parseEnvFile", () => {
  it("KEY=VALUE・引用符・export・コメントに対応", () => {
    const env = parseEnvFile(['# c', 'A=1', 'export B="two words"', "C='x' ", 'D=val # 後ろのコメント', '', 'bad line', 'E='].join("\n"));
    expect(env).toEqual({ A: "1", B: "two words", C: "x", D: "val", E: "" });
  });
});

describe("clipFileName", () => {
  it("元の名前 + 連番", () => {
    expect(clipFileName("kakutei_03", 0)).toBe("kakutei_03_01.mp3");
    expect(clipFileName("花火", 11)).toBe("花火_12.mp3");
  });
});
