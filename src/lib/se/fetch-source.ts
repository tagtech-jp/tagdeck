// 音源の自動取得（2026-10-17 社長指示「URL や検索語の指定から全自動で source_se まで用意する」）の純関数部分。
// yt-dlp の起動とファイル入出力は scripts/se/fetch-source.ts。ここは一覧の読み取り・ファイル名・yt-dlp の引数・
// 下ごしらえ（prep-source）に渡す cuts / map の組み立てだけ（テストは fetch-source.test.ts）。
//
// 流れ: source_raw/sources.csv（url・name・theme・start・end）→ yt-dlp で id と題名を調べる → {id}-{題名}.{ext} に取得
//       → 行ごとの start / end を cuts に、theme を map に組み立てて prep-source に渡す → source_se/ に wav が並ぶ
// 社長の検証用クローズド環境だけで使う。取得元の権利は社長の責任。取得した音源は他の利用者には配られない（S23 の設計）。

import { parseTimecode, sanitizeName } from "./prep-source";

export interface SourceSpec {
  /** yt-dlp に渡す URL か検索（ytsearch3:キーワード など yt-dlp の書式そのまま） */
  url: string;
  /** 出力名（空なら題名） */
  name: string | null;
  /** 置き場のフォルダ（テーマの言葉） */
  theme: string | null;
  /** 区間（秒）。両方 null なら丸ごと */
  start: number | null;
  end: number | null;
}

/** yt-dlp が返す 1 件（--print "%(id)s\t%(title)s\t%(duration)s"） */
export interface ResolvedMedia {
  id: string;
  title: string;
  /** 秒。不明なら null */
  duration: number | null;
}

export interface FetchedFile {
  /** sources の行 */
  spec: SourceSpec;
  media: ResolvedMedia;
  /** source_raw からの相対ファイル名（拡張子つき） */
  file: string;
}

export interface CutRow {
  file: string;
  start: number;
  end: number | null;
  name: string | null;
  theme: string | null;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function toSec(v: string, label: string, row: string): number | null {
  if (!v) return null;
  try {
    return parseTimecode(v);
  } catch {
    throw new Error(`${row}: ${label}（${v}）の形が不正（秒・mm:ss・hh:mm:ss）`);
  }
}

/**
 * sources.csv（UTF-8・BOM 可・CRLF 可・# で始まる行は無視）。1 行目は見出し（url,name,theme,start,end。順は自由。url は必須）
 *   url,name,theme,start,end
 *   https://www.youtube.com/watch?v=xxxx,北斗_確定,確定,1:23.5,1:26
 *   https://www.youtube.com/watch?v=xxxx,,,2:10,           ← 同じ url は 1 回だけ取得し、行ごとに区間を切る
 *   ytsearch3:確定音 パチンコ,,ジャックポット,,              ← yt-dlp の検索書式。上位 3 件を丸ごと
 */
export function parseSourcesCsv(text: string): SourceSpec[] {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const col = (n: string) => header.indexOf(n);
  const iUrl = col("url");
  if (iUrl < 0) throw new Error("sources.csv の 1 行目は見出しにする（url,name,theme,start,end。順は自由。url は必須）");
  const iName = col("name");
  const iTheme = col("theme");
  const iStart = col("start");
  const iEnd = col("end");
  return lines.slice(1).map((line, k) => {
    const c = splitCsvLine(line);
    const row = `sources.csv ${k + 2} 行目`;
    const url = c[iUrl] ?? "";
    if (!url) throw new Error(`${row}: url が空`);
    const start = iStart >= 0 ? toSec(c[iStart] ?? "", "start", row) : null;
    const end = iEnd >= 0 ? toSec(c[iEnd] ?? "", "end", row) : null;
    if (start !== null && end !== null && end <= start) throw new Error(`${row}: end が start 以下`);
    const name = iName >= 0 && c[iName] ? c[iName] : null;
    const theme = iTheme >= 0 && c[iTheme] ? c[iTheme] : null;
    return { url, name, theme, start, end };
  });
}

/** sources.json: [{ "url": "...", "name": "...", "theme": "...", "start": "1:23", "end": 86 }, ...] */
export function parseSourcesJson(text: string): SourceSpec[] {
  const data: unknown = JSON.parse(text.replace(/^﻿/, ""));
  if (!Array.isArray(data)) throw new Error("sources.json は配列にする（[{url,name,theme,start,end}, ...]）");
  return data.map((row, k) => {
    const n = `sources.json ${k + 1} 件目`;
    if (typeof row !== "object" || row === null) throw new Error(`${n}: オブジェクトでない`);
    const r = row as Record<string, unknown>;
    const url = typeof r.url === "string" ? r.url.trim() : "";
    if (!url) throw new Error(`${n}: url が空`);
    const sec = (v: unknown, label: string): number | null => {
      if (v === undefined || v === null || v === "") return null;
      if (typeof v === "number") {
        if (!Number.isFinite(v) || v < 0) throw new Error(`${n}: ${label} が不正`);
        return v;
      }
      if (typeof v === "string") return toSec(v, label, n);
      throw new Error(`${n}: ${label} は数値か "mm:ss"`);
    };
    const start = sec(r.start, "start");
    const end = sec(r.end, "end");
    if (start !== null && end !== null && end <= start) throw new Error(`${n}: end が start 以下`);
    const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : null;
    const theme = typeof r.theme === "string" && r.theme.trim() ? r.theme.trim() : null;
    return { url, name, theme, start, end };
  });
}

/** yt-dlp の --print "%(id)s\t%(title)s\t%(duration)s" の出力（1 行 1 件）を読む。空行は飛ばす */
export function parseResolvedLines(text: string): ResolvedMedia[] {
  const out: ResolvedMedia[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [id, title, dur] = line.split("\t");
    if (!id) continue;
    const d = dur === undefined || dur === "" || dur === "NA" ? NaN : Number(dur);
    out.push({ id: id.trim(), title: (title ?? "").trim() || id.trim(), duration: Number.isFinite(d) ? d : null });
  }
  return out;
}

/** 取得先のファイル名の幹: {id}-{題名}（題名は sanitizeName・60 文字まで） */
export function fileStemFor(media: ResolvedMedia): string {
  const safeId = sanitizeName(media.id).replace(/\s+/g, "_");
  const title = sanitizeName(media.title).slice(0, 60).trim();
  return title && title !== safeId ? `${safeId}-${title}` : safeId;
}

/** yt-dlp の引数: id と題名を調べるだけ（ダウンロードしない） */
export function ytdlpResolveArgs(url: string): string[] {
  return ["--no-warnings", "--simulate", "--no-playlist", "--print", "%(id)s\t%(title)s\t%(duration)s", "--", url];
}

/**
 * yt-dlp の引数: 音声だけを元の形式のまま取得（再エンコードしない。変換は prep-source の ffmpeg が行う）。
 * 出力は {outDir}/{stem}.{ext}。既にあれば上書きしない
 */
export function ytdlpDownloadArgs(url: string, outDir: string, stem: string): string[] {
  return ["--no-warnings", "--no-playlist", "--no-overwrites", "-f", "bestaudio/best", "-o", `${outDir}/${stem}.%(ext)s`, "--print", "after_move:filepath", "--", url];
}

/** 取得済みファイルから、prep-source に渡す cuts（区間のある行）と map（テーマのある取得先 → フォルダ）を組み立てる */
export function buildPrepInputs(files: readonly FetchedFile[]): { cuts: CutRow[]; map: Record<string, string>; warnings: string[] } {
  const cuts: CutRow[] = [];
  const map: Record<string, string> = {};
  const warnings: string[] = [];
  for (const f of files) {
    const stem = f.file.replace(/\.[^.]+$/, "");
    const hasRange = f.spec.start !== null || f.spec.end !== null;
    if (hasRange) {
      const start = f.spec.start ?? 0;
      if (f.media.duration !== null && start >= f.media.duration) {
        warnings.push(`${f.file}: start（${start} 秒）が長さ（${f.media.duration} 秒）以上なので飛ばす`);
        continue;
      }
      cuts.push({ file: f.file, start, end: f.spec.end, name: f.spec.name, theme: f.spec.theme });
    } else if (f.spec.name && f.spec.name !== stem) {
      // 丸ごとでも名前の指定があれば、名前付きの 1 本として切り出す（分類の言葉を名前に入れられるように）
      cuts.push({ file: f.file, start: 0, end: null, name: f.spec.name, theme: f.spec.theme });
    } else if (f.spec.theme) {
      map[stem] = f.spec.theme;
    }
  }
  return { cuts, map, warnings };
}

function csvCell(v: string | number | null): string {
  if (v === null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** prep-source が読む cuts.csv の本文 */
export function cutsCsvText(cuts: readonly CutRow[]): string {
  const lines = ["file,start,end,name,theme"];
  for (const c of cuts) lines.push([csvCell(c.file), csvCell(c.start), csvCell(c.end), csvCell(c.name), csvCell(c.theme)].join(","));
  return lines.join("\n") + "\n";
}
