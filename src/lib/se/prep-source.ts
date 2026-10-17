// 元メディアの下ごしらえ（2026-10-17 社長指示「音源の自動取得・切り出しも含めて 1 コマンドで」のうち、手元の元動画・音声から
// タイムスタンプとキーワードで切り出して source_se に置く部分）。ffmpeg の呼び出しとファイル入出力は scripts/se/prep-source.ts。
// ここは純関数だけ（テストは prep-source.test.ts）。
//
// 流れ:
//   source_raw/ の元ファイル（録画・所有の動画や音声）
//     + cuts.csv / cuts.json（元ファイル・開始・終了・出力名・テーマ）
//     + map.json（元ファイル名に含まれる言葉 → テーマ）
//   → 計画（planPrep）: 出力は {テーマ}/{名前}.wav か {名前}.wav。区間の無い元ファイルは丸ごと 1 本
//   → ffmpeg で wav（mono 44.1kHz）に書き出し（CLI 側）
//   → そのあと pnpm se:pack が 2〜5 秒に切り出し・音量そろえ・分類・割り当て・登録を行う
// 分類は pack-import.ts の classifyPackFile と同じ（フォルダ名 → ファイル名の言葉）。ここでは計画の段階で分類を付けて、
// 「分類なし」になる出力を警告する（名前かフォルダにテーマの言葉を入れれば直る）

import { classifyPackFile, PACK_GENERIC, type PackCategory } from "./pack-import";

export interface CutSpec {
  /** 元ファイル（--in からの相対パス。ファイル名だけ・拡張子なし・大小文字違いでも当てる） */
  file: string;
  /** 開始（秒） */
  start: number;
  /** 終了（秒）。null は末尾まで */
  end: number | null;
  /** 出力名（拡張子なし）。null なら 元の名前_開始時刻 */
  name: string | null;
  /** 置き場のフォルダ（テーマの言葉）。null なら map.json の言葉で決め、無ければフォルダなし */
  theme: string | null;
}

export interface PrepJob {
  /** 元ファイル（--in からの相対・区切りは /） */
  src: string;
  start: number | null;
  end: number | null;
  /** 出力（--out からの相対・区切りは /）。{テーマ}/{名前}.wav か {名前}.wav */
  out: string;
  /** pnpm se:pack が付ける分類（同じ関数で先に求めたもの） */
  category: PackCategory;
}

export interface PrepPlan {
  jobs: PrepJob[];
  warnings: string[];
}

/** 元ファイル名に含まれる言葉（大小文字は区別しない）→ テーマのフォルダ名 */
export type ThemeMap = Record<string, string>;

export interface PlanPrepOptions {
  /** 区間指定（cuts）の無い元ファイルを丸ごと置かない */
  onlyCuts?: boolean;
}

/** "83" / "83.5" / "1:23.5" / "01:23" / "1:02:03.25" → 秒 */
export function parseTimecode(text: string): number {
  const parts = text.trim().split(":");
  if (parts.length < 1 || parts.length > 3 || parts.some((p) => !/^\d+(?:\.\d+)?$/.test(p))) {
    throw new Error(`時刻の形が不正です: "${text}"（秒・mm:ss・hh:mm:ss。小数可）`);
  }
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

/** ファイル名に使えない文字を _ に。空なら clip */
export function sanitizeName(name: string): string {
  const s = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  return s.length > 0 ? s.slice(0, 80) : "clip";
}

/** 1 行の CSV を列に分ける（"..." の中のカンマと "" に対応） */
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

/**
 * cuts.csv（UTF-8・BOM 可・CRLF 可・# で始まる行は無視）。1 行目は見出し（file,start,end,name,theme。順は自由。file と start は必須）
 *   file,start,end,name,theme
 *   北斗_録画.mp4,1:23.5,1:26,北斗_確定,確定
 *   北斗_録画.mp4,2:10,,激アツ_先読み,          ← end 空 = 末尾まで / theme 空 = 名前の言葉か map.json で決める
 */
export function parseCutsCsv(text: string): CutSpec[] {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iFile = col("file");
  const iStart = col("start");
  const iEnd = col("end");
  const iName = col("name");
  const iTheme = col("theme");
  if (iFile < 0 || iStart < 0) throw new Error("cuts.csv の 1 行目は見出しにする（file,start,end,name,theme。順は自由。file と start は必須）");
  return lines.slice(1).map((line, k) => {
    const c = splitCsvLine(line);
    const row = k + 2;
    const file = c[iFile] ?? "";
    if (!file) throw new Error(`cuts.csv ${row} 行目: file が空`);
    const start = parseTimecode(c[iStart] || "0");
    const endText = iEnd >= 0 ? (c[iEnd] ?? "") : "";
    const end = endText ? parseTimecode(endText) : null;
    if (end !== null && end <= start) throw new Error(`cuts.csv ${row} 行目: end（${endText}）が start 以下`);
    const name = iName >= 0 && c[iName] ? c[iName] : null;
    const theme = iTheme >= 0 && c[iTheme] ? c[iTheme] : null;
    return { file, start, end, name, theme };
  });
}

/** cuts.json: [{ "file": "北斗_録画.mp4", "start": "1:23.5", "end": 86, "name": "北斗_確定", "theme": "確定" }, ...]（start/end は数値か "mm:ss"） */
export function parseCutsJson(text: string): CutSpec[] {
  const data: unknown = JSON.parse(text.replace(/^﻿/, ""));
  if (!Array.isArray(data)) throw new Error("cuts.json は配列にする（[{file,start,end,name,theme}, ...]）");
  return data.map((row, k) => {
    const n = k + 1;
    if (typeof row !== "object" || row === null) throw new Error(`cuts.json ${n} 件目: オブジェクトでない`);
    const r = row as Record<string, unknown>;
    const file = typeof r.file === "string" ? r.file.trim() : "";
    if (!file) throw new Error(`cuts.json ${n} 件目: file が空`);
    const toSec = (v: unknown, label: string): number | null => {
      if (v === undefined || v === null || v === "") return null;
      if (typeof v === "number") {
        if (!Number.isFinite(v) || v < 0) throw new Error(`cuts.json ${n} 件目: ${label} が不正`);
        return v;
      }
      if (typeof v === "string") return parseTimecode(v);
      throw new Error(`cuts.json ${n} 件目: ${label} は数値か "mm:ss"`);
    };
    const start = toSec(r.start, "start") ?? 0;
    const end = toSec(r.end, "end");
    if (end !== null && end <= start) throw new Error(`cuts.json ${n} 件目: end が start 以下`);
    const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : null;
    const theme = typeof r.theme === "string" && r.theme.trim() ? r.theme.trim() : null;
    return { file, start, end, name, theme };
  });
}

/** map.json の言葉が元ファイル名（相対パス）に含まれていればそのテーマ。長い言葉から順に見る */
export function themeForSource(relPath: string, map: ThemeMap): string | null {
  const hay = relPath.toLowerCase();
  const entries = Object.entries(map)
    .map(([w, t]) => [w.trim().toLowerCase(), t.trim()] as const)
    .filter(([w, t]) => w.length > 0 && t.length > 0)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [w, t] of entries) if (hay.includes(w)) return sanitizeName(t);
  return null;
}

function stemOf(rel: string): string {
  return (rel.split("/").pop() ?? rel).replace(/\.[^.]+$/, "");
}

/** 83.5 → "01m23.5s"（自動の出力名に使う） */
function timeLabel(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, "0")}m${s.toFixed(1).padStart(4, "0")}s`;
}

/**
 * 計画。cuts の各行を元ファイルに当てて {テーマ}/{名前}.wav を決め、cuts の無い元ファイルは丸ごと {テーマ}/{元の名前}.wav。
 * テーマは cuts の theme → map.json → なし の順。同じ出力名は _2, _3 … で分ける。分類なしになる出力は警告に出す
 */
export function planPrep(sources: readonly string[], cuts: readonly CutSpec[], map: ThemeMap, o: PlanPrepOptions = {}): PrepPlan {
  const warnings: string[] = [];
  const srcList = sources.map((s) => s.split(/[\\/]/).join("/"));
  const missing = new Set<string>();
  const find = (file: string): string | null => {
    const f = file.split(/[\\/]/).join("/").toLowerCase();
    const exact = srcList.find((s) => s.toLowerCase() === f);
    if (exact) return exact;
    const base = f.split("/").pop() ?? f;
    const baseNoExt = base.replace(/\.[^.]+$/, "");
    const hits = srcList.filter((s) => {
      const b = (s.split("/").pop() ?? s).toLowerCase();
      return b === base || b.replace(/\.[^.]+$/, "") === baseNoExt;
    });
    if (hits.length === 1) return hits[0];
    if (!missing.has(f)) {
      missing.add(f);
      warnings.push(
        hits.length > 1
          ? `cuts の file "${file}" に当たる元ファイルが ${hits.length} 件あります（相対パスで指定する）: ${hits.join(", ")}`
          : `cuts の file "${file}" に当たる元ファイルがありません`,
      );
    }
    return null;
  };
  const jobs: PrepJob[] = [];
  const used = new Set<string>();
  const place = (theme: string | null, name: string): string => {
    const base = theme ? `${theme}/${name}` : name;
    let out = `${base}.wav`;
    for (let n = 2; used.has(out.toLowerCase()); n++) out = `${base}_${n}.wav`;
    used.add(out.toLowerCase());
    return out;
  };
  const cutSources = new Set<string>();
  for (const c of cuts) {
    const src = find(c.file);
    if (!src) continue;
    cutSources.add(src);
    const name = sanitizeName(c.name ?? `${stemOf(src)}_${timeLabel(c.start)}`);
    const theme = c.theme ? sanitizeName(c.theme) : themeForSource(src, map);
    const out = place(theme, name);
    jobs.push({ src, start: c.start, end: c.end, out, category: classifyPackFile(out) });
  }
  if (!o.onlyCuts) {
    for (const src of srcList) {
      if (cutSources.has(src)) continue;
      const out = place(themeForSource(src, map), sanitizeName(stemOf(src)));
      jobs.push({ src, start: null, end: null, out, category: classifyPackFile(out) });
    }
  }
  for (const j of jobs) {
    if (j.category === PACK_GENERIC) warnings.push(`分類なし: ${j.out}（名前かフォルダにテーマの言葉を入れるか、map.json で「元ファイル名の言葉」→「テーマ」を書く）`);
  }
  return { jobs, warnings };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * 1 本を wav（mono 44.1kHz・pcm_s16le）に書き出す ffmpeg の引数。`-ss` を `-i` より前に置いて速く頭出しする。映像でも `-vn` で音だけ。
 * end が null なら末尾まで
 */
export function ffmpegPrepArgs(src: string, out: string, start: number | null, end: number | null): string[] {
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  if (start !== null && start > 0) args.push("-ss", String(round3(start)));
  if (end !== null) args.push("-t", String(round3(end - (start ?? 0))));
  args.push("-i", src, "-vn", "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", out);
  return args;
}
