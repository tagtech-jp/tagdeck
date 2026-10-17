// 元メディアの下ごしらえ CLI（ローカル専用・2026-10-17）: source_raw/ の元動画・音声（録画・所有ファイル）を、cuts.csv（区間・名前・テーマ）と
// map.json（元ファイル名の言葉 → テーマ）で切り出して source_se/ に置く。そのあと pnpm se:pack か scripts/se/run-pack.ps1 が取り込む。
//
// 使い方:
//   pnpm se:prep                                        # source_raw → source_se（source_raw/cuts.csv・cuts.json・map.json があれば使う）
//   pnpm se:prep --in D:\raw --out .\source_se --cuts D:\raw\cuts.csv --map D:\raw\map.json
//   pnpm se:prep --dry-run                              # 計画だけ表示（ffmpeg は呼ばない）
//   pnpm se:prep --only-cuts                            # 区間指定の無い元ファイルは丸ごと置かない
//   pnpm se:prep --force                                # 出力が元より新しくても作り直す
//   .\scripts\se\run-pack.ps1 -PreScript .\scripts\se\prep-source.ps1 -- --max-clips 40        # 下ごしらえ → dry-run → 確認 → 本実行 を 1 コマンドで
//   PRE_SCRIPT=scripts/se/prep-source.sh bash scripts/se/run-pack.sh ./source_se --max-clips 40   # bash 版
//
// cuts.csv（UTF-8・見出し行あり・列の順は自由・# で始まる行は無視）:
//   file,start,end,name,theme
//   北斗_録画.mp4,1:23.5,1:26,北斗_確定,確定
//   北斗_録画.mp4,2:10,,激アツ_先読み,          ← end 空 = 末尾まで / theme 空 = 名前の言葉か map.json で決める
// map.json: { "北斗": "確定", "play": "リーチ" }   ← 元ファイル名に含まれる言葉 → 置き場のフォルダ（テーマの言葉）
//
// 出力は wav（mono 44.1kHz・無圧縮）。2〜5 秒への切り出し・音量そろえ・mp3 化・分類・割り当て・登録は pnpm se:pack が行う。
// 元ファイルは消さない。出力が元より新しければ飛ばす（--force で作り直す）。終了コード: 0 成功 / 1 ffmpeg か引数の失敗 / 2 置くものが 0 件

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { PACK_GENERIC, packCategoryLabel } from "../../src/lib/se/pack-import";
import { ffmpegPrepArgs, parseCutsCsv, parseCutsJson, planPrep, type CutSpec, type PrepJob, type ThemeMap } from "../../src/lib/se/prep-source";

const run = promisify(execFile);

interface Args {
  in: string;
  out: string;
  cuts: string | null;
  map: string | null;
  onlyCuts: boolean;
  dryRun: boolean;
  force: boolean;
  concurrency: number;
}

function usage(): void {
  console.log(`使い方:
  pnpm se:prep [--in source_raw] [--out source_se] [--cuts <csv|json>] [--map <json>] [--only-cuts] [--dry-run] [--force] [--concurrency 4]
  （source_raw/cuts.csv・cuts.json・map.json は置いてあれば自動で使う）`);
}

function parseArgs(argv: string[]): Args {
  const a: Args = { in: "source_raw", out: "source_se", cuts: null, map: null, onlyCuts: false, dryRun: false, force: false, concurrency: 4 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${k} に値がありません`);
      return x;
    };
    switch (k) {
      case "--in": a.in = v(); break;
      case "--out": a.out = v(); break;
      case "--cuts": a.cuts = v(); break;
      case "--map": a.map = v(); break;
      case "--only-cuts": a.onlyCuts = true; break;
      case "--dry-run": a.dryRun = true; break;
      case "--force": a.force = true; break;
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

// pnpm se:pack と同じ拡張子
const MEDIA_RE = /\.(mp3|ogg|oga|wav|m4a|aac|flac|opus|webm|mp4|mkv|mov|avi|m4v|wmv|ts|mpg|mpeg)$/i;

async function scan(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    for (const name of (await readdir(dir)).sort()) {
      if (name.startsWith(".")) continue;
      const abs = path.join(dir, name);
      const s = await stat(abs);
      if (s.isDirectory()) await walk(abs);
      else if (MEDIA_RE.test(name)) out.push(path.relative(root, abs).split(path.sep).join("/"));
    }
  };
  await walk(root);
  return out;
}

function firstExisting(candidates: readonly string[]): string | null {
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

async function loadCuts(file: string): Promise<CutSpec[]> {
  const text = await readFile(file, "utf-8");
  return file.toLowerCase().endsWith(".json") ? parseCutsJson(text) : parseCutsCsv(text);
}

async function loadMap(file: string): Promise<ThemeMap> {
  const data: unknown = JSON.parse((await readFile(file, "utf-8")).replace(/^\uFEFF/, ""));
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error(`${file} は { "元ファイル名の言葉": "テーマ" } の形にする`);
  const out: ThemeMap = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (typeof v !== "string") throw new Error(`${file}: "${k}" の値は文字列（テーマの言葉）にする`);
    out[k] = v;
  }
  return out;
}

async function mapLimit<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

function rangeLabel(j: PrepJob): string {
  if (j.start === null && j.end === null) return "丸ごと";
  const s = (j.start ?? 0).toFixed(1);
  return j.end === null ? `${s}s〜末尾` : `${s}s〜${j.end.toFixed(1)}s`;
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const inDir = path.resolve(a.in);
  if (!existsSync(inDir) || !(await stat(inDir)).isDirectory()) {
    throw new Error(`元メディアのフォルダがありません: ${inDir}（source_raw を作って録画・所有の動画や音声を置く。区間は cuts.csv、テーマは map.json）`);
  }
  const sources = await scan(inDir);
  const cutsPath = a.cuts ?? firstExisting([path.join(inDir, "cuts.csv"), path.join(inDir, "cuts.json")]);
  const mapPath = a.map ?? firstExisting([path.join(inDir, "map.json")]);
  const cuts = cutsPath ? await loadCuts(cutsPath) : [];
  const map = mapPath ? await loadMap(mapPath) : {};
  console.log(`元: ${inDir}（メディア ${sources.length} 件）/ 区間: ${cutsPath ? `${cutsPath}（${cuts.length} 件）` : "なし（丸ごと）"} / テーマ表: ${mapPath ?? "なし"}`);
  if (sources.length === 0) {
    console.error("× 元メディアが 0 件です（mp3 / wav / m4a / mp4 / mkv / webm などを source_raw に置く）");
    process.exit(2);
  }
  const plan = planPrep(sources, cuts, map, { onlyCuts: a.onlyCuts });
  console.log(`計画（${plan.jobs.length} 本）:`);
  for (const j of plan.jobs) console.log(`  ${j.out}  ←  ${j.src}（${rangeLabel(j)}）  [${packCategoryLabel(j.category)}]`);
  for (const w of plan.warnings) console.warn(`! ${w}`);
  if (plan.jobs.length === 0) {
    console.error("× 置くものが 0 件です（cuts の file が元ファイルに当たっていないか、--only-cuts で全部除外された）");
    process.exit(2);
  }
  if (a.dryRun) {
    console.log("dry-run: ffmpeg は呼んでいません");
    return;
  }

  const outDir = path.resolve(a.out);
  await mkdir(outDir, { recursive: true });
  let done = 0;
  let skipped = 0;
  const failed: string[] = [];
  await mapLimit(plan.jobs, a.concurrency, async (j) => {
    const src = path.join(inDir, ...j.src.split("/"));
    const out = path.join(outDir, ...j.out.split("/"));
    await mkdir(path.dirname(out), { recursive: true });
    if (!a.force && existsSync(out)) {
      const [so, ss] = await Promise.all([stat(out), stat(src)]);
      if (so.size > 0 && so.mtimeMs >= ss.mtimeMs) {
        skipped++;
        return;
      }
    }
    try {
      await run("ffmpeg", ffmpegPrepArgs(src, out, j.start, j.end), { maxBuffer: 16 * 1024 * 1024 });
      done++;
    } catch (e) {
      const msg = e instanceof Error ? e.message.split("\n").filter((l) => l.trim())[0] ?? e.message : String(e);
      failed.push(j.out);
      console.error(`× ${j.out}: ${msg}`);
    }
  });

  const byCat = new Map<string, number>();
  for (const j of plan.jobs) if (!failed.includes(j.out)) byCat.set(packCategoryLabel(j.category), (byCat.get(packCategoryLabel(j.category)) ?? 0) + 1);
  console.log(`置き場: ${outDir}（新規 ${done} 本・使い回し ${skipped} 本・失敗 ${failed.length} 本）`);
  for (const [label, n] of [...byCat.entries()].sort((x, y) => y[1] - x[1])) console.log(`  ${label}: ${n} 本`);
  const generic = plan.jobs.filter((j) => j.category === PACK_GENERIC).length;
  if (generic > 0) console.log(`  → 分類なしの ${generic} 本は、テーマの音が無いアイテムにだけ回る。名前かフォルダにテーマの言葉を入れると直る`);
  console.log(`次: pnpm se:pack --src ${a.out} --dry-run（または .\\scripts\\se\\run-pack.ps1 -Src ${a.out}）`);
  if (failed.length > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(`× ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
