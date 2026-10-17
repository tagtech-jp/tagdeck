// 音源の自動取得 CLI（ローカル専用・2026-10-17 社長指示「URL や検索語の指定から全自動で source_se まで用意する」）:
// source_raw/sources.csv（url・name・theme・start・end）の URL / 検索を yt-dlp で取得して source_raw/ に置き、
// 行ごとの区間とテーマを cuts.csv / map.json に組み立てて、続けて pnpm se:prep（切り出し → source_se/）まで行う。
//
// 使い方:
//   pnpm se:fetch                                   # source_raw/sources.csv（または sources.json）→ 取得 → 下ごしらえ → source_se/
//   pnpm se:fetch --list D:\lists\sources.csv --out .\source_raw --prep-out .\source_se
//   pnpm se:fetch --dry-run                         # 取得せず、id・題名・長さ・置き場の名前と計画だけ表示
//   pnpm se:fetch --no-prep                         # 取得だけ（下ごしらえは pnpm se:prep で別に）
//   .\scripts\se\run-pack.ps1 -PreScript .\scripts\se\fetch-source.ps1 -- --max-clips 40   # 取得 → 下ごしらえ → dry-run → 確認 → 本実行 を 1 コマンドで
//
// sources.csv（UTF-8・1 行目は見出し url,name,theme,start,end・順は自由・# で始まる行は無視）:
//   url,name,theme,start,end
//   https://www.youtube.com/watch?v=xxxx,北斗_確定,確定,1:23.5,1:26     ← 区間を切って 確定/北斗_確定.wav に
//   https://www.youtube.com/watch?v=xxxx,,,2:10,                        ← 同じ url は 1 回だけ取得。この行は 2:10〜末尾
//   ytsearch3:確定音 パチンコ,,ジャックポット,,                          ← yt-dlp の検索書式。上位 3 件を丸ごと ジャックポット/ に
//   北斗_録画.mp4,,,0:05,0:08                                           ← source_raw に置いた手元のファイルも同じ表で扱える（取得しない）
// 取得先は source_raw/{id}-{題名}.{元の拡張子}（音声だけ・再エンコードしない。wav への変換は pnpm se:prep）。
// 既に同じ id のファイルがあれば取得しない（使い回し）。cuts.csv と map.json は sources.csv から毎回作り直す。
// 必要な道具: yt-dlp（python -m pip install --user yt-dlp）と ffmpeg / ffprobe。
// 社長の検証用クローズド環境だけで使う。取得元の権利は社長の責任。取得した音源は他の利用者に配られない（S23 の設計）。
// 終了コード: 0 成功 / 1 取得か下ごしらえの失敗（1 件でも）/ 2 取得できたものが 0 件

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { buildPrepInputs, cutsCsvText, fileStemFor, parseResolvedLines, parseSourcesCsv, parseSourcesJson, ytdlpDownloadArgs, ytdlpResolveArgs, type FetchedFile, type ResolvedMedia, type SourceSpec } from "../../src/lib/se/fetch-source";

const run = promisify(execFile);

interface Args {
  list: string | null;
  out: string;
  prepOut: string;
  dryRun: boolean;
  noPrep: boolean;
  concurrency: number;
}

function usage(): void {
  console.log(`使い方:
  pnpm se:fetch [--list source_raw/sources.csv|json] [--out source_raw] [--prep-out source_se] [--dry-run] [--no-prep] [--concurrency 2]`);
}

function parseArgs(argv: string[]): Args {
  const a: Args = { list: null, out: "source_raw", prepOut: "source_se", dryRun: false, noPrep: false, concurrency: 2 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${k} に値がありません`);
      return x;
    };
    switch (k) {
      case "--list": a.list = v(); break;
      case "--out": a.out = v(); break;
      case "--prep-out": a.prepOut = v(); break;
      case "--dry-run": a.dryRun = true; break;
      case "--no-prep": a.noPrep = true; break;
      case "--concurrency": a.concurrency = Number(v()); break;
      case "-h":
      case "--help":
        usage();
        process.exit(0);
      // eslint-disable-next-line no-fallthrough
      default:
        throw new Error(`不明な引数: ${k}（--help で使い方）`);
    }
  }
  if (!Number.isFinite(a.concurrency) || a.concurrency < 1) throw new Error("--concurrency は 1 以上の数");
  return a;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

function firstExisting(candidates: readonly string[]): string | null {
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

async function requireTool(name: string, versionArgs: string[]): Promise<string> {
  try {
    const { stdout } = await run(name, versionArgs);
    return String(stdout).trim().split(/\r?\n/)[0] ?? "";
  } catch {
    throw new Error(`${name} が見つかりません。${name === "yt-dlp" ? "python -m pip install --user yt-dlp でインストールして PATH を通す" : "インストールして PATH を通す"}`);
  }
}

/** 既に取得済みの {stem}.{ext} を探す（拡張子は何でも） */
async function findByStem(outDir: string, stem: string): Promise<string | null> {
  const names = await readdir(outDir);
  const hit = names.find((n) => n.startsWith(`${stem}.`) && !n.endsWith(".part") && !n.endsWith(".ytdl"));
  return hit ?? null;
}

async function resolve(url: string): Promise<ResolvedMedia[]> {
  const { stdout } = await run("yt-dlp", ytdlpResolveArgs(url), { maxBuffer: 16 * 1024 * 1024 });
  return parseResolvedLines(String(stdout));
}

async function download(url: string, outDir: string, stem: string): Promise<string> {
  // 検索（ytsearchN:）は複数件になるので、取得は id を URL にして 1 件ずつ行う
  const { stdout } = await run("yt-dlp", ytdlpDownloadArgs(url, outDir, stem), { maxBuffer: 16 * 1024 * 1024 });
  const printed = String(stdout).trim().split(/\r?\n/).filter((l) => l.trim()).pop() ?? "";
  const name = printed ? path.basename(printed) : await findByStem(outDir, stem);
  if (!name || !existsSync(path.join(outDir, name))) throw new Error(`取得後のファイルが見つかりません（${stem}）`);
  return name;
}

function isLocalFile(url: string, outDir: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(url) && existsSync(path.join(outDir, url));
}

function quoteArg(s: string): string {
  return /[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

function runPrep(outDir: string, prepOut: string): Promise<number> {
  return new Promise((resolveExit) => {
    const cmd = ["pnpm", "se:prep", "--in", quoteArg(outDir), "--out", quoteArg(prepOut)].join(" ");
    const child = spawn(cmd, { stdio: "inherit", shell: true });
    child.on("exit", (code) => resolveExit(code ?? 1));
    child.on("error", () => resolveExit(1));
  });
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(a.out);
  await mkdir(outDir, { recursive: true });
  const listPath = a.list ?? firstExisting([path.join(outDir, "sources.csv"), path.join(outDir, "sources.json")]);
  if (!listPath) throw new Error(`取得の一覧がありません: ${path.join(outDir, "sources.csv")}（url,name,theme,start,end の表。--list で別の場所も可）`);
  const text = await readFile(listPath, "utf-8");
  const specs: SourceSpec[] = listPath.toLowerCase().endsWith(".json") ? parseSourcesJson(text) : parseSourcesCsv(text);
  if (specs.length === 0) {
    console.error(`× ${listPath} に行がありません`);
    process.exit(2);
  }
  // 手元のファイルだけの一覧なら yt-dlp は要らない（取得する行が 1 つでもあれば必須）
  const urls = [...new Set(specs.map((s) => s.url))];
  const needsYtdlp = urls.some((u) => !isLocalFile(u, outDir));
  const ytdlp = needsYtdlp ? await requireTool("yt-dlp", ["--version"]) : "不要（手元のファイルだけ）";
  await requireTool("ffmpeg", ["-version"]);
  console.log(`一覧: ${listPath}（${specs.length} 行）/ 取得先: ${outDir} / yt-dlp ${ytdlp}`);

  // url ごとに 1 回だけ調べる（同じ url の行は区間違い）
  const failures: string[] = [];
  const resolved = new Map<string, ResolvedMedia[]>();
  await mapLimit(urls, a.concurrency, async (url) => {
    if (isLocalFile(url, outDir)) {
      const stem = url.replace(/\.[^.]+$/, "");
      resolved.set(url, [{ id: stem, title: stem, duration: null }]);
      return;
    }
    try {
      const list = await resolve(url);
      if (list.length === 0) failures.push(`${url}: 見つかりません（0 件）`);
      resolved.set(url, list);
    } catch (e) {
      failures.push(`${url}: ${firstLine(e)}`);
      resolved.set(url, []);
    }
  });

  // 取得（id ごとに 1 回。検索は id を URL に）
  const files: FetchedFile[] = [];
  const fetchedById = new Map<string, string>();
  let downloaded = 0;
  let reused = 0;
  const jobs: Array<{ spec: SourceSpec; media: ResolvedMedia; local: boolean }> = [];
  for (const spec of specs) for (const media of resolved.get(spec.url) ?? []) jobs.push({ spec, media, local: isLocalFile(spec.url, outDir) });
  console.log(`取得する: ${new Set(jobs.map((j) => j.media.id)).size} 件（行 ${jobs.length}）`);
  for (const j of jobs) {
    const stem = fileStemFor(j.media);
    console.log(`  ${j.media.id}  ${j.media.title}${j.media.duration !== null ? `（${j.media.duration.toFixed(0)} 秒）` : ""}  → ${stem}.*${j.spec.start !== null || j.spec.end !== null ? `  区間 ${j.spec.start ?? 0}〜${j.spec.end ?? "末尾"}` : ""}${j.spec.theme ? `  [${j.spec.theme}]` : ""}`);
  }
  for (const w of failures) console.warn(`! ${w}`);
  if (a.dryRun) {
    console.log("dry-run: 取得も下ごしらえもしていません");
    if (failures.length > 0) process.exit(1);
    return;
  }
  const uniqueJobs = [...new Map(jobs.map((j) => [j.media.id, j])).values()];
  await mapLimit(uniqueJobs, a.concurrency, async (j) => {
    if (j.local) {
      fetchedById.set(j.media.id, j.spec.url);
      reused++;
      return;
    }
    const stem = fileStemFor(j.media);
    const existing = await findByStem(outDir, stem);
    if (existing) {
      fetchedById.set(j.media.id, existing);
      reused++;
      return;
    }
    try {
      const name = await download(j.media.id.length > 0 && /^ytsearch/i.test(j.spec.url) ? j.media.id : j.spec.url, outDir, stem);
      fetchedById.set(j.media.id, name);
      downloaded++;
      console.log(`  取得: ${name}`);
    } catch (e) {
      failures.push(`${j.media.id}（${j.media.title}）: ${firstLine(e)}`);
    }
  });
  for (const j of jobs) {
    const file = fetchedById.get(j.media.id);
    if (file) files.push({ spec: j.spec, media: j.media, file });
  }
  console.log(`取得: 新規 ${downloaded} 件・使い回し ${reused} 件・失敗 ${failures.length} 件`);
  if (files.length === 0) {
    for (const w of failures) console.error(`× ${w}`);
    console.error("× 取得できたものが 0 件です");
    process.exit(2);
  }

  // prep-source に渡す cuts.csv / map.json（sources.csv から毎回作り直す）
  const { cuts, map, warnings } = buildPrepInputs(files);
  for (const w of warnings) console.warn(`! ${w}`);
  await writeFile(path.join(outDir, "cuts.csv"), cutsCsvText(cuts), "utf-8");
  await writeFile(path.join(outDir, "map.json"), JSON.stringify(map, null, 2) + "\n", "utf-8");
  console.log(`下ごしらえの指示: cuts ${cuts.length} 行・map ${Object.keys(map).length} 件 → ${path.join(outDir, "cuts.csv")} / map.json`);

  if (a.noPrep) {
    console.log(`次: pnpm se:prep --in ${a.out} --out ${a.prepOut}`);
    if (failures.length > 0) process.exit(1);
    return;
  }
  console.log("=== 下ごしらえ（pnpm se:prep） ===");
  const code = await runPrep(outDir, path.resolve(a.prepOut));
  if (code !== 0) {
    console.error(`× 下ごしらえが失敗しました（exit ${code}）`);
    process.exit(1);
  }
  if (failures.length > 0) {
    for (const w of failures) console.error(`× 取得できなかった: ${w}`);
    process.exit(1);
  }
}

function firstLine(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const lines = msg.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  return lines.find((l) => /^ERROR/i.test(l)) ?? lines[0] ?? msg;
}

main().catch((e: unknown) => {
  console.error(`× ${firstLine(e)}`);
  process.exit(1);
});

// readdir / stat は findByStem と将来の拡張のために import している（stat は未使用の警告を避けるため参照）
void stat;
