import { describe, expect, it } from "vitest";
import { buildPrepInputs, cutsCsvText, fileStemFor, parseResolvedLines, parseSourcesCsv, parseSourcesJson, ytdlpDownloadArgs, ytdlpResolveArgs, type FetchedFile } from "./fetch-source";

describe("parseSourcesCsv（url・name・theme・start・end）", () => {
  it("BOM・CRLF・コメント・列の順の違いに対応し、同じ url の複数行と検索の行を受ける", () => {
    const text = '\uFEFFname,url,theme,start,end\r\n# メモ\r\n北斗_確定,https://www.youtube.com/watch?v=abc,確定,1:23.5,1:26\r\n,https://www.youtube.com/watch?v=abc,,2:10,\r\n,ytsearch3:確定音 パチンコ,ジャックポット,,\r\n';
    expect(parseSourcesCsv(text)).toEqual([
      { url: "https://www.youtube.com/watch?v=abc", name: "北斗_確定", theme: "確定", start: 83.5, end: 86 },
      { url: "https://www.youtube.com/watch?v=abc", name: null, theme: null, start: 130, end: null },
      { url: "ytsearch3:確定音 パチンコ", name: null, theme: "ジャックポット", start: null, end: null },
    ]);
  });
  it("空文字は 0 件・url 見出しが無ければ例外・url が空なら例外・end が start 以下なら例外・時刻が不正なら例外", () => {
    expect(parseSourcesCsv("")).toEqual([]);
    expect(() => parseSourcesCsv("name,start\nx,1\n")).toThrow(/見出し/);
    expect(() => parseSourcesCsv("url,start\n,1\n")).toThrow(/url が空/);
    expect(() => parseSourcesCsv("url,start,end\nhttps://x/y,10,10\n")).toThrow(/start 以下/);
    expect(() => parseSourcesCsv("url,start\nhttps://x/y,abc\n")).toThrow(/形が不正/);
  });
});

describe("parseSourcesJson", () => {
  it("数値と mm:ss の両方を受け、省略は null", () => {
    expect(parseSourcesJson('[{"url":"https://x/y","start":"1:00","end":65,"name":"キュイン","theme":"確定"},{"url":"https://x/z"}]')).toEqual([
      { url: "https://x/y", name: "キュイン", theme: "確定", start: 60, end: 65 },
      { url: "https://x/z", name: null, theme: null, start: null, end: null },
    ]);
  });
  it("配列でない・url が空・end が start 以下 は例外", () => {
    expect(() => parseSourcesJson("{}")).toThrow(/配列/);
    expect(() => parseSourcesJson('[{"start":1}]')).toThrow(/url が空/);
    expect(() => parseSourcesJson('[{"url":"https://x/y","start":5,"end":5}]')).toThrow(/start 以下/);
  });
});

describe("parseResolvedLines（yt-dlp の --print の出力）", () => {
  it("タブ区切りの id・題名・長さ。NA や空は null、題名が空なら id、空行は飛ばす", () => {
    expect(parseResolvedLines("abc\t北斗 確定演出集\t615.0\n\nxyz\t\tNA\nq1\tq2\n")).toEqual([
      { id: "abc", title: "北斗 確定演出集", duration: 615 },
      { id: "xyz", title: "xyz", duration: null },
      { id: "q1", title: "q2", duration: null },
    ]);
  });
});

describe("fileStemFor（{id}-{題名}）", () => {
  it("題名はファイル名に使える形にして 60 文字まで。題名が id と同じなら id だけ", () => {
    expect(fileStemFor({ id: "abc", title: "北斗/確定: 演出集?", duration: null })).toBe("abc-北斗_確定_ 演出集_");
    expect(fileStemFor({ id: "abc", title: "abc", duration: null })).toBe("abc");
    expect(fileStemFor({ id: "abc", title: "あ".repeat(100), duration: null })).toBe(`abc-${"あ".repeat(60)}`);
    expect(fileStemFor({ id: "a b", title: "t", duration: null })).toBe("a_b-t");
  });
});

describe("yt-dlp の引数", () => {
  it("調べるだけ: --simulate と --print、url は -- の後", () => {
    const a = ytdlpResolveArgs("https://x/y");
    expect(a).toEqual(expect.arrayContaining(["--simulate", "--print", "--no-playlist"]));
    expect(a.slice(-2)).toEqual(["--", "https://x/y"]);
  });
  it("取得: 音声だけ元の形式のまま・上書きしない・出力は {outDir}/{stem}.{ext}", () => {
    const a = ytdlpDownloadArgs("https://x/y", "D:\\raw", "abc-北斗");
    expect(a).toEqual(expect.arrayContaining(["-f", "bestaudio/best", "--no-overwrites", "-o", "D:\\raw/abc-北斗.%(ext)s", "--print", "after_move:filepath"]));
    expect(a.slice(-2)).toEqual(["--", "https://x/y"]);
  });
});

describe("buildPrepInputs（prep-source に渡す cuts / map）", () => {
  const media = { id: "abc", title: "北斗 確定演出集", duration: 600 };
  const file = "abc-北斗 確定演出集.webm";
  const mk = (spec: FetchedFile["spec"]): FetchedFile => ({ spec, media, file });

  it("区間のある行は cuts、名前だけの行は 0 秒〜末尾の名前付き 1 本、テーマだけの行は map、何もない行は何もしない", () => {
    const { cuts, map, warnings } = buildPrepInputs([
      mk({ url: "u", name: "北斗_確定", theme: "確定", start: 83.5, end: 86 }),
      mk({ url: "u", name: null, theme: null, start: 130, end: null }),
      mk({ url: "u", name: "激アツ_先読み", theme: null, start: null, end: null }),
      mk({ url: "u", name: null, theme: "リーチ", start: null, end: null }),
      mk({ url: "u", name: null, theme: null, start: null, end: null }),
    ]);
    expect(cuts).toEqual([
      { file, start: 83.5, end: 86, name: "北斗_確定", theme: "確定" },
      { file, start: 130, end: null, name: null, theme: null },
      { file, start: 0, end: null, name: "激アツ_先読み", theme: null },
    ]);
    expect(map).toEqual({ "abc-北斗 確定演出集": "リーチ" });
    expect(warnings).toEqual([]);
  });

  it("start が長さ以上の行は警告して飛ばす", () => {
    const { cuts, warnings } = buildPrepInputs([mk({ url: "u", name: null, theme: null, start: 700, end: null })]);
    expect(cuts).toEqual([]);
    expect(warnings).toEqual([expect.stringContaining("700 秒")]);
  });
});

describe("cutsCsvText", () => {
  it("見出しと行。カンマや引用符を含む値は引用する", () => {
    const text = cutsCsvText([
      { file: "a, b.webm", start: 1.5, end: null, name: 'x"y', theme: "確定" },
      { file: "c.webm", start: 0, end: 2, name: null, theme: null },
    ]);
    expect(text).toBe('file,start,end,name,theme\n"a, b.webm",1.5,,"x""y",確定\nc.webm,0,2,,\n');
  });
});
