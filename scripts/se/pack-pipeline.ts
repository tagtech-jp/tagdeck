// 音源パックの一括取り込み CLI（2026-10-17 社長指示「手元に用意した音源を、プログラムで自動解析してアイテムへ一括割り当て」）。
// ローカル専用。手元のソースディレクトリ（音声・動画）→ ffmpeg で切り出し・ノーマライズ → フォルダ名・ファイル名でテーマ分類 →
// 全アイテムに割り当て → 自分のアカウントの Supabase Storage（バケット se）と se_mappings に一括登録。
//
// 使い方（リポジトリのフォルダで。Python の道具と同じく ffmpeg / ffprobe が要る）:
//   pnpm se:pack --src D:\se-src                      # 切り出し → 分類 → 登録
//   pnpm se:pack --src D:\se-src --dry-run            # 登録はせず、切り出しと計画だけ（out に pack-manifest.json）
//   pnpm se:pack --src D:\se-ready --skip-clip        # 既に短く整えた mp3/wav 等をそのまま使う
//   pnpm se:pack --undo .se-pack/out/pack-manifest.json [--purge]   # 取り込んだ行を消す（--purge で Storage の音源も消す）
//
// 主な引数:
//   --src <dir>        ソースディレクトリ（再帰）。サブフォルダ名・ファイル名の言葉で分類する（src/lib/se/pack-import.ts classifyPackFile）
//   --out <dir>        切り出し先（既定 .se-pack/out）。pack-manifest.json もここ
//   --user <uuid>      登録先のユーザー id（既定: 環境変数 SE_PACK_USER_ID → SE_DEFAULT_SOURCE_USER_ID）
//   --min 2 --max 5    切り出す尺（秒）。--lufs -14 音量。--max-clips 8 1 ファイルから作る最大本数
//   --noise -35        無音とみなすしきい値（dBFS）。実音源で切れ目が拾えないときは -45〜-30 の間で調整する
//   --min-silence 0.3  無音が続く最短秒数。これより短い途切れは 1 つの音として扱う
//   --all              価格もカテゴリも無いアイテム（販売終了・その他）も対象にする（既定は SE タブの「価格ありのみ」と同じ）
//   --items <json>     DB の代わりにアイテム一覧を JSON から読む（/api/platforms/whowatch/items/patterns の応答と同じ形）
//   --env <file>       環境変数のファイル（既定 .env.local）。DATABASE_URL / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY を読む
//   --concurrency 4    同時に走らせる ffmpeg の数
//
// 環境変数（.env.local。値はログに出さない）:
//   DATABASE_URL                 アイテム一覧の取得と se_mappings の書き込み（drizzle と同じ）
//   NEXT_PUBLIC_SUPABASE_URL     Storage の URL
//   SUPABASE_SERVICE_ROLE_KEY    Storage へのアップロード（バケット se の書き込みは auth.uid() 配下だけなので、他人の id のパスへは service role が要る。
//                                Supabase ダッシュボード → Project Settings → API → service_role）
//
// 設計:
//   - 分類・計画は src/lib/se/pack-import.ts（SE タブと同じ純関数）、切り出しの決め方は src/lib/se/pack-clip.ts。ここは I/O だけ
//   - 同じ音源は 1 回だけ上げる。Storage のパスは {user}/pack/{相対パスのハッシュ}_{名前}.mp3 で固定し、再実行しても増えない（upsert）
//   - 行は 500 件ずつ 1 文の upsert（/api/se/mappings の PUT と同じ制約: key の形・url のホスト）
//   - public/se/ には何も置かない（sound-license.test.ts の対象外）。他の利用者に配られる音は従来どおり CC0 の置き換えだけ

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDbClient } from "../../src/lib/db/client";
import { itemPointMapping, seMappings, whowatchItemGroups, whowatchItemPatterns, whowatchItemPrices } from "../../src/lib/db/schema";
import { chooseClips, clipFileName, ffmpegClipArgs, ffmpegSilenceArgs, nonSilentRanges, parseEnvFile, parseSilenceDetect } from "../../src/lib/se/pack-clip";
import { PACK_EXT_RE, PACK_MAX_BYTES, packCategoryLabel, planPackImport, type PackFile, type PackItem, type PackPlan } from "../../src/lib/se/pack-import";

const run = promisify(execFile);

// ── 引数 ──────────────────────────────────────────────────────────
interface Args {
  src: string | null;
  out: string;
  user: string | null;
  min: number;
  max: number;
  lufs: number;
  maxClips: number;
  /** 無音とみなすしきい値（dBFS）と、無音が続く最短秒数（silencedetect の noise / d） */
  noise: number;
  minSilence: number;
  all: boolean;
  items: string | null;
  env: string;
  concurrency: number;
  dryRun: boolean;
  skipClip: boolean;
  undo: string | null;
  purge: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { src: null, out: ".se-pack/out", user: null, min: 2, max: 5, lufs: -14, maxClips: 8, noise: -35, minSilence: 0.3, all: false, items: null, env: ".env.local", concurrency: 4, dryRun: false, skipClip: false, undo: null, purge: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${k} に値が要ります`);
      return x;
    };
    switch (k) {
      case "--": break; // pnpm run が引数の前に付けることがある区切り
      case "--src": a.src = v(); break;
      case "--out": a.out = v(); break;
      case "--user": a.user = v(); break;
      case "--min": a.min = Number(v()); break;
      case "--max": a.max = Number(v()); break;
      case "--lufs": a.lufs = Number(v()); break;
      case "--max-clips": a.maxClips = Number(v()); break;
      case "--noise": a.noise = Number(v()); break;
      case "--min-silence": a.minSilence = Number(v()); break;
      case "--all": a.all = true; break;
      case "--items": a.items = v(); break;
      case "--env": a.env = v(); break;
      case "--concurrency": a.concurrency = Number(v()); break;
      case "--dry-run": a.dryRun = true; break;
      case "--skip-clip": a.skipClip = true; break;
      case "--undo": a.undo = v(); break;
      case "--purge": a.purge = true; break;
      case "-h": case "--help": printHelp(); process.exit(0);
      default: throw new Error(`不明な引数: ${k}（--help で一覧）`);
    }
  }
  if (!a.undo && !a.src) throw new Error("--src <dir> か --undo <manifest> が要ります（--help で一覧）");
  for (const [name, n] of [["--min", a.min], ["--max", a.max], ["--lufs", a.lufs], ["--max-clips", a.maxClips], ["--noise", a.noise], ["--min-silence", a.minSilence], ["--concurrency", a.concurrency]] as const) {
    if (!Number.isFinite(n)) throw new Error(`${name} は数値で指定してください`);
  }
  return a;
}

function printHelp(): void {
  console.log(`音源パックの一括取り込み CLI
  pnpm se:pack --src <dir> [--out <dir>] [--user <uuid>] [--min 2] [--max 5] [--lufs -14] [--max-clips 8] [--noise -35] [--min-silence 0.3] [--all] [--skip-clip] [--dry-run] [--items <json>] [--env .env.local] [--concurrency 4]
  pnpm se:pack --undo <pack-manifest.json> [--purge]
詳しくは scripts/se/pack-pipeline.ts の先頭コメント`);
}

// ── 環境変数 ──────────────────────────────────────────────────────
async function loadEnv(file: string): Promise<void> {
  if (!existsSync(file)) return;
  const env = parseEnvFile(await readFile(file, "utf-8"));
  for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;
}

function requireEnv(name: string): string {
  const v = (process.env[name] ?? "").trim();
  if (!v) throw new Error(`環境変数 ${name} が未設定です（.env.local か --env のファイルに書く）`);
  return v;
}

// ── 入力の走査 ──────────────────────────────────────────────────
const MEDIA_RE = /\.(mp3|ogg|oga|wav|m4a|aac|flac|opus|webm|mp4|mkv|mov|avi|m4v|wmv|ts|mpg|mpeg)$/i;

interface SourceFile {
  abs: string;
  /** src からの相対パス（区切りは /） */
  rel: string;
  size: number;
}

async function scanSources(root: string): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  const walk = async (dir: string) => {
    for (const name of (await readdir(dir)).sort()) {
      if (name.startsWith(".")) continue;
      const abs = path.join(dir, name);
      const s = await stat(abs);
      if (s.isDirectory()) await walk(abs);
      else if (MEDIA_RE.test(name)) out.push({ abs, rel: path.relative(root, abs).split(path.sep).join("/"), size: s.size });
    }
  };
  await walk(root);
  return out;
}

// ── 切り出し（ffmpeg） ─────────────────────────────────────────
async function probeDuration(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  const d = Number(String(stdout).trim());
  return Number.isFinite(d) ? d : 0;
}

async function detectSilence(file: string, noiseDb: number, minSilenceSec: number): Promise<string> {
  // 出力は捨てるので stderr だけ要る。ffmpeg は -f null でも終了コード 0
  const { stderr } = await run("ffmpeg", ffmpegSilenceArgs(file, noiseDb, minSilenceSec), { maxBuffer: 64 * 1024 * 1024 });
  return String(stderr);
}

interface Clip extends PackFile {
  abs: string;
  /** 元ファイル（src からの相対） */
  from: string;
  start: number;
  end: number;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function clipSources(sources: readonly SourceFile[], a: Args, rootName: string): Promise<Clip[]> {
  const clips: Clip[] = [];
  let done = 0;
  const perSource = await mapLimit(sources, a.concurrency, async (src) => {
    const relDir = path.posix.dirname(src.rel);
    const stem = path.posix.basename(src.rel).replace(/\.[^.]+$/, "");
    const outDir = path.join(a.out, ...(relDir === "." ? [] : relDir.split("/")));
    await mkdir(outDir, { recursive: true });
    const duration = await probeDuration(src.abs);
    const silences = parseSilenceDetect(await detectSilence(src.abs, a.noise, a.minSilence));
    const ranges = chooseClips(nonSilentRanges(silences, duration), duration, { minSec: a.min, maxSec: a.max, maxClips: a.maxClips });
    const made: Clip[] = [];
    const srcStat = await stat(src.abs);
    for (const [i, r] of ranges.entries()) {
      const name = clipFileName(stem, i);
      const abs = path.join(outDir, name);
      // 既にあって元より新しければ作り直さない（再実行を速く）
      const cached = existsSync(abs) && (await stat(abs)).mtimeMs >= srcStat.mtimeMs;
      if (!cached) await run("ffmpeg", ffmpegClipArgs(src.abs, abs, r, a.lufs));
      const size = (await stat(abs)).size;
      made.push({ name, relPath: `${rootName}/${relDir === "." ? "" : `${relDir}/`}${name}`, size, abs, from: src.rel, start: r.start, end: r.end });
    }
    done++;
    console.log(`  [${done}/${sources.length}] ${src.rel} → ${made.length} 本（${duration.toFixed(1)}s）`);
    return made;
  });
  for (const m of perSource) clips.push(...m);
  return clips;
}

/** --skip-clip: 元ファイルをそのまま使う（/api/se/upload と同じ制限: mp3/ogg/wav/m4a/aac・20MB 以下） */
function sourcesAsClips(sources: readonly SourceFile[], rootName: string): Clip[] {
  return sources
    .filter((s) => PACK_EXT_RE.test(s.rel))
    .map((s) => ({ name: path.posix.basename(s.rel), relPath: `${rootName}/${s.rel}`, size: s.size, abs: s.abs, from: s.rel, start: 0, end: 0 }));
}

// ── アイテム一覧 ──────────────────────────────────────────────
interface TargetItem extends PackItem {
  priced: boolean;
}

async function loadItemsFromJson(file: string): Promise<TargetItem[]> {
  const d = JSON.parse(await readFile(file, "utf-8")) as { items?: Array<{ itemId: number; itemName: string; priceJpy?: number | null; groups?: string[]; patterns?: Array<{ patternId: number; isHit: boolean }> }> };
  return (d.items ?? []).map((i) => ({ itemId: i.itemId, itemName: i.itemName, groups: i.groups ?? [], patterns: i.patterns ?? [], priced: i.priceJpy != null && i.priceJpy > 0 }));
}

/** /api/platforms/whowatch/items/patterns と同じ組み立て（価格の有無・カテゴリ・当たりパターン） */
async function loadItemsFromDb(db: ReturnType<typeof createDbClient>): Promise<TargetItem[]> {
  const [patterns, groups, unit, mapping] = await Promise.all([
    db.select({ patternId: whowatchItemPatterns.patternId, itemId: whowatchItemPatterns.itemId, itemName: whowatchItemPatterns.itemName, isHit: whowatchItemPatterns.isHit }).from(whowatchItemPatterns),
    db.select({ itemId: whowatchItemGroups.itemId, groupKey: whowatchItemGroups.groupKey, displayOrder: whowatchItemGroups.displayOrder }).from(whowatchItemGroups).catch(() => []),
    db.select({ itemId: whowatchItemPrices.itemId, unitPriceJpy: whowatchItemPrices.unitPriceJpy }).from(whowatchItemPrices).catch(() => []),
    db.select({ itemId: itemPointMapping.itemId, priceJpy: itemPointMapping.priceJpy, state: itemPointMapping.state }).from(itemPointMapping).where(eq(itemPointMapping.platform, "whowatch")),
  ]);
  const priced = new Set<number>();
  for (const m of mapping) if (m.priceJpy > 0 && m.state !== "FREE") priced.add(Number(m.itemId));
  for (const u of unit) if (u.unitPriceJpy > 0) priced.add(u.itemId);
  const groupsByItem = new Map<number, string[]>();
  for (const g of [...groups].sort((x, y) => (x.displayOrder ?? 9999) - (y.displayOrder ?? 9999))) (groupsByItem.get(g.itemId) ?? groupsByItem.set(g.itemId, []).get(g.itemId)!).push(g.groupKey);
  const items = new Map<number, TargetItem>();
  for (const p of patterns) {
    const it = items.get(p.itemId) ?? { itemId: p.itemId, itemName: p.itemName, groups: groupsByItem.get(p.itemId) ?? [], patterns: [] as Array<{ patternId: number; isHit: boolean }>, priced: priced.has(p.itemId) };
    (it.patterns as Array<{ patternId: number; isHit: boolean }>).push({ patternId: p.patternId, isHit: p.isHit });
    items.set(p.itemId, it);
  }
  return [...items.values()].sort((x, y) => x.itemId - y.itemId);
}

// ── 登録（Storage + se_mappings） ─────────────────────────────
interface Manifest {
  createdAt: string;
  userId: string | null;
  src: string;
  dryRun: boolean;
  clips: Array<{ relPath: string; from: string; start: number; end: number; size: number; category: string }>;
  summary: Pick<PackPlan, "itemsAssigned" | "itemsWithoutSound" | "hitPatternsAssigned" | "bulkGradesAssigned"> & { targetItems: number; usedFiles: number; skipped: number };
  assignments: Array<{ key: string; relPath: string }>;
  /** 登録したときだけ: 相対パス → Storage のパスと URL */
  uploaded: Record<string, { path: string; url: string }>;
  keys: string[];
}

function storagePath(userId: string, c: Clip): string {
  const h = createHash("sha1").update(c.relPath).digest("hex").slice(0, 12);
  const safe = c.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 60);
  return `${userId}/pack/${h}_${safe}`;
}

const CONTENT_TYPES: Record<string, string> = { mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac" };
const CHUNK = 500;

async function register(db: ReturnType<typeof createDbClient>, userId: string, clips: readonly Clip[], plan: PackPlan, a: Args): Promise<Manifest["uploaded"]> {
  const supabase = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  const bucket = supabase.storage.from("se");
  const uploaded: Manifest["uploaded"] = {};
  let n = 0;
  await mapLimit(plan.usedFiles, a.concurrency, async (idx) => {
    const c = clips[idx];
    const p = storagePath(userId, c);
    const ext = c.name.split(".").pop()!.toLowerCase();
    const body = new Blob([await readFile(c.abs)], { type: CONTENT_TYPES[ext] ?? "application/octet-stream" });
    const { error } = await bucket.upload(p, body, { upsert: true, contentType: CONTENT_TYPES[ext] });
    if (error) throw new Error(`アップロード失敗: ${c.relPath}: ${error.message}`);
    uploaded[c.relPath] = { path: p, url: bucket.getPublicUrl(p).data.publicUrl };
    n++;
    if (n % 20 === 0 || n === plan.usedFiles.length) console.log(`  アップロード ${n}/${plan.usedFiles.length}`);
  });
  const now = new Date();
  const rows = plan.assignments.map((x) => ({ userId, key: x.key, url: uploaded[clips[x.fileIndex].relPath].url, volume: 80, enabled: true, label: clips[x.fileIndex].name.slice(0, 100), updatedAt: now }));
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db
      .insert(seMappings)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoUpdate({ target: [seMappings.userId, seMappings.key], set: { url: sql`excluded.url`, volume: sql`excluded.volume`, enabled: sql`excluded.enabled`, label: sql`excluded.label`, updatedAt: now } });
    console.log(`  割り当てを保存 ${Math.min(i + CHUNK, rows.length)}/${rows.length} 行`);
  }
  return uploaded;
}

async function undo(file: string, a: Args): Promise<void> {
  const m = JSON.parse(await readFile(file, "utf-8")) as Manifest;
  if (!m.userId || m.keys.length === 0) throw new Error("この manifest には登録の記録がありません（--dry-run の結果か、key が 0 件）");
  const db = createDbClient();
  let deleted = 0;
  for (let i = 0; i < m.keys.length; i += CHUNK) {
    const r = await db.delete(seMappings).where(and(eq(seMappings.userId, m.userId), inArray(seMappings.key, m.keys.slice(i, i + CHUNK)))).returning({ key: seMappings.key });
    deleted += r.length;
  }
  console.log(`se_mappings から ${deleted} 行を消しました（manifest の key ${m.keys.length} 件）`);
  if (a.purge) {
    const supabase = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
    const paths = Object.values(m.uploaded).map((u) => u.path);
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await supabase.storage.from("se").remove(paths.slice(i, i + 100));
      if (error) throw new Error(`Storage の削除に失敗: ${error.message}`);
    }
    console.log(`Storage から ${paths.length} 本を消しました`);
  } else if (Object.keys(m.uploaded).length > 0) {
    console.log(`Storage の音源 ${Object.keys(m.uploaded).length} 本は残しています（消すなら --purge）`);
  }
}

// ── 本体 ──────────────────────────────────────────────────────
async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  await loadEnv(a.env);
  if (a.undo) {
    await undo(a.undo, a);
    return;
  }
  const srcRoot = path.resolve(a.src!);
  if (!existsSync(srcRoot)) throw new Error(`--src が見つかりません: ${srcRoot}`);
  const rootName = path.basename(srcRoot);
  const sources = await scanSources(srcRoot);
  if (sources.length === 0) throw new Error(`音声・動画ファイルがありません: ${srcRoot}`);
  console.log(`ソース ${sources.length} ファイル（${srcRoot}）`);

  let clips: Clip[];
  if (a.skipClip) {
    clips = sourcesAsClips(sources, rootName);
    console.log(`--skip-clip: ${clips.length} ファイルをそのまま使う（mp3/ogg/wav/m4a/aac 以外は除外）`);
  } else {
    await mkdir(a.out, { recursive: true });
    console.log(`切り出し（${a.min}〜${a.max} 秒・${a.lufs} LUFS・1 ファイル最大 ${a.maxClips} 本・無音は ${a.noise}dB 以下が ${a.minSilence} 秒以上）→ ${path.resolve(a.out)}`);
    clips = await clipSources(sources, a, rootName);
  }
  const oversized = clips.filter((c) => c.size > PACK_MAX_BYTES);
  if (oversized.length > 0) console.log(`20MB 超で除外: ${oversized.length} 本`);

  const userId = a.user ?? (process.env.SE_PACK_USER_ID ?? process.env.SE_DEFAULT_SOURCE_USER_ID ?? "").trim();
  const db = a.items ? null : createDbClient();
  const allItems = a.items ? await loadItemsFromJson(a.items) : await loadItemsFromDb(db!);
  const items = a.all ? allItems : allItems.filter((i) => i.priced || (i.groups?.length ?? 0) > 0);
  console.log(`対象アイテム ${items.length} 件${a.all ? "（すべて）" : `（価格ありかカテゴリ付き。全 ${allItems.length} 件、--all で全部）`}`);

  const plan = planPackImport(clips, items);
  const cats = Object.entries(plan.categories).sort((x, y) => y[1].length - x[1].length);
  console.log("分類:");
  for (const [cat, idx] of cats) console.log(`  ${packCategoryLabel(cat)}: ${idx.length} 本`);
  console.log(`割り当て: ${plan.itemsAssigned} アイテム（音が決まらない ${plan.itemsWithoutSound} 件）・当たりパターン ${plan.hitPatternsAssigned} 件・まとめ投げ ${plan.bulkGradesAssigned} 段階 → ${plan.assignments.length} 行・音源 ${plan.usedFiles.length} 本`);
  if (plan.skipped.length > 0) console.log(`対象外: ${plan.skipped.length} 本（${plan.skipped.slice(0, 5).map((s) => `${clips[s.index].name}: ${s.reason}`).join(" / ")}${plan.skipped.length > 5 ? " …" : ""}）`);

  const manifest: Manifest = {
    createdAt: new Date().toISOString(),
    userId: a.dryRun ? null : userId,
    src: srcRoot,
    dryRun: a.dryRun,
    clips: clips.map((c) => ({ relPath: c.relPath, from: c.from, start: c.start, end: c.end, size: c.size, category: Object.entries(plan.categories).find(([, idx]) => idx.includes(clips.indexOf(c)))?.[0] ?? "-" })),
    summary: { itemsAssigned: plan.itemsAssigned, itemsWithoutSound: plan.itemsWithoutSound, hitPatternsAssigned: plan.hitPatternsAssigned, bulkGradesAssigned: plan.bulkGradesAssigned, targetItems: items.length, usedFiles: plan.usedFiles.length, skipped: plan.skipped.length },
    assignments: plan.assignments.map((x) => ({ key: x.key, relPath: clips[x.fileIndex].relPath })),
    uploaded: {},
    keys: [],
  };
  const manifestPath = path.join(a.out, "pack-manifest.json");
  await mkdir(a.out, { recursive: true });

  if (a.dryRun) {
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`--dry-run: 登録はしていません。計画は ${manifestPath}`);
    return;
  }
  if (!userId) throw new Error("登録先のユーザー id が要ります（--user <uuid> か 環境変数 SE_PACK_USER_ID / SE_DEFAULT_SOURCE_USER_ID）");
  if (plan.assignments.length === 0) throw new Error("割り当てられる組み合わせがありません（対象アイテム 0 件か、音源が当たり・段階の分類だけ）");
  if (!db) throw new Error("--items を使うときは --dry-run にしてください（登録には DATABASE_URL の DB が要ります）");

  manifest.uploaded = await register(db, userId, clips, plan, a);
  manifest.keys = plan.assignments.map((x) => x.key);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`完了: 音源 ${plan.usedFiles.length} 本・${manifest.keys.length} 行を登録しました。取り消すなら:\n  pnpm se:pack --undo ${manifestPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
