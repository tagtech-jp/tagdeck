// 音源の切り出し（ffmpeg）の純関数部分（2026-10-17・音源パックの一括取り込み CLI scripts/se/pack-pipeline.ts から使う）。
// ffmpeg / ffprobe の呼び出し自体はスクリプト側。ここは出力の解析・切り出し区間の決め方・引数の組み立てだけ（テストは pack-clip.test.ts）。
//
// 切り出しの考え方:
//   - `silencedetect` で無音区間を取り、その補集合（音のある区間）を候補にする
//   - 候補が最大尺より長ければ先頭から最大尺（効果音の立ち上がりは先頭にある）。最小尺より短ければ後ろ（足りなければ前）に伸ばす
//   - 伸ばして重なった候補は 1 つにまとめる。本数が多ければ長い候補から maxClips 本
//   - 無音区間が無い（ずっと鳴っている）ファイルは、先頭から最大尺を 1 本
//   - 音量は loudnorm で揃える（自動ライブラリの有料ミックスと同じ -14 LUFS が既定）。末尾は短くフェードアウト

export interface Range {
  start: number;
  end: number;
}

export interface ClipOptions {
  /** 最小尺（秒） */
  minSec: number;
  /** 最大尺（秒） */
  maxSec: number;
  /** 1 ファイルから作る最大本数 */
  maxClips: number;
}

/** ffmpeg の `-af silencedetect` が stderr に出す行から無音区間を取る。末尾まで無音が続く（silence_end が無い）場合は end = Infinity */
export function parseSilenceDetect(stderr: string): Range[] {
  const out: Range[] = [];
  let open: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (s) {
      open = Number(s[1]);
      continue;
    }
    const e = /silence_end:\s*(-?[\d.]+)/.exec(line);
    if (e) {
      const end = Number(e[1]);
      out.push({ start: open ?? Math.max(0, end), end });
      open = null;
    }
  }
  if (open !== null) out.push({ start: open, end: Number.POSITIVE_INFINITY });
  return out.map((r) => ({ start: Math.max(0, r.start), end: r.end })).sort((a, b) => a.start - b.start);
}

/** 無音区間の補集合（音のある区間）。minLen 未満のかけらは捨てる */
export function nonSilentRanges(silences: readonly Range[], duration: number, minLen = 0.15): Range[] {
  const out: Range[] = [];
  let cursor = 0;
  for (const s of [...silences].sort((a, b) => a.start - b.start)) {
    const start = Math.min(Math.max(s.start, 0), duration);
    const end = Math.min(s.end, duration);
    if (start > cursor) out.push({ start: cursor, end: start });
    cursor = Math.max(cursor, end);
  }
  if (cursor < duration) out.push({ start: cursor, end: duration });
  return out.filter((r) => r.end - r.start >= minLen);
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** 切り出す区間を決める（上の「切り出しの考え方」） */
export function chooseClips(ranges: readonly Range[], duration: number, o: ClipOptions): Range[] {
  if (!(duration > 0)) return [];
  const minSec = Math.max(0.3, o.minSec);
  const maxSec = Math.max(minSec, o.maxSec);
  if (ranges.length === 0) return [{ start: 0, end: round(Math.min(maxSec, duration)) }];
  // 長い候補から maxClips 本
  const picked = [...ranges]
    .map((r, i) => ({ r, i, len: r.end - r.start }))
    .sort((a, b) => b.len - a.len || a.i - b.i)
    .slice(0, Math.max(1, o.maxClips))
    .sort((a, b) => a.r.start - b.r.start)
    .map(({ r }) => r);
  const fitted: Range[] = [];
  for (const r of picked) {
    let start = r.start;
    let end = Math.min(r.end, start + maxSec);
    if (end - start < minSec) {
      end = Math.min(duration, start + minSec);
      if (end - start < minSec) start = Math.max(0, end - minSec);
    }
    const last = fitted[fitted.length - 1];
    if (last && start < last.end) {
      // 伸ばして重なった → 1 つにまとめる（最大尺は守る）
      last.end = Math.min(Math.max(last.end, end), last.start + maxSec);
      continue;
    }
    fitted.push({ start, end });
  }
  return fitted.filter((c) => c.end - c.start >= 0.3).map((c) => ({ start: round(c.start), end: round(c.end) }));
}

/**
 * 1 本を切り出す ffmpeg の引数。mono 44.1kHz・mp3 96k（自動ライブラリと同じ形）。
 * `-ss` を `-i` より前に置いて速く頭出しする。映像ファイルでも `-vn` で音だけ取る
 */
export function ffmpegClipArgs(src: string, out: string, clip: Range, lufs: number): string[] {
  const len = round(clip.end - clip.start);
  const fadeSec = 0.12;
  const filters = [`loudnorm=I=${lufs}:TP=-1.5:LRA=11`, "aresample=44100"];
  if (len > 0.5) filters.push(`afade=t=out:st=${round(len - fadeSec)}:d=${fadeSec}`);
  return ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(round(clip.start)), "-t", String(len), "-i", src, "-vn", "-ac", "1", "-ar", "44100", "-af", filters.join(","), "-codec:a", "libmp3lame", "-b:a", "96k", out];
}

/** 無音検出の ffmpeg 引数（出力は捨てる。stderr を parseSilenceDetect に渡す） */
export function ffmpegSilenceArgs(src: string, noiseDb = -35, minSilenceSec = 0.3): string[] {
  return ["-hide_banner", "-nostats", "-i", src, "-vn", "-af", `silencedetect=noise=${noiseDb}dB:d=${minSilenceSec}`, "-f", "null", "-"];
}

/** `.env.local` の KEY=VALUE を読む（コメント・空行・export・引用符に対応。既にある環境変数は上書きしない前提で呼び元が使う） */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]] = v;
  }
  return out;
}

/** 切り出し後のファイル名: 元の名前 + 連番（分類は元の名前の言葉で決まるので、名前は残す） */
export function clipFileName(stem: string, index: number): string {
  return `${stem}_${String(index + 1).padStart(2, "0")}.mp3`;
}
