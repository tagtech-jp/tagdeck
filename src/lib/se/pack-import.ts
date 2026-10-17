// 音源パックの一括取り込み（2026-10-17 社長指示「手元に用意した音源を、プログラムで自動解析してアイテムへ一括割り当て」）。
//
// 仕組み（ローカル専用 CLI scripts/se/pack-pipeline.ts から使う純関数）:
//   - 音源の置かれたサブフォルダ名とファイル名の言葉から「分類」を決める（classifyPackFile）。
//     分類は自動ライブラリのテーマ（花火・ねこ・コイン…・auto-library.ts の THEME_LABELS）と、当たり（hit）・
//     まとめ投げの段階（bulk-COOL / GREAT / FANTASTIC / MIRACLE）・どれでもない（generic）
//   - アイテムごとに自動ライブラリと同じ themeForItem でテーマを決め、同じ分類の音を最大 5 本（item:{id}・#2〜#5）割り当てる（planPackImport）。
//     同じテーマの音が無ければ generic → テーマ付きの音すべて の順に落とす。当たりのパターンには hit の音（pattern:{id}）、
//     まとめ投げの段階には bulk-{段階} の音（bulk:{段階}）
//   - 同じテーマのアイテムが同じ 5 本に偏らないよう、アイテム id から決めた位置からずらして選ぶ（再実行しても同じ結果）
//   - 音源は自分のアカウントの Storage にだけ上がり、行は se_mappings に 1 文の upsert でまとめて入る（CLI 側）。
//     他の利用者に配られることはない（公式既定の配布は S23 のとおり CC0 の置き換えだけ）。public/se/ には何も置かないので
//     sound-license.test.ts の対象にもならない
//   - ここは純関数だけ（Node のスクリプト・テストの両方で使う。ブラウザでも動く）

import { THEME_LABELS, themeForItem } from "./auto-library";
import { BULK_GRADE_LABELS, MAIN_BULK_GRADES, type BulkGrade } from "./bulk-grade";
import { variantKeys } from "./choose-sound";

/** 分類: テーマ key（THEME_LABELS のキー）| "hit" | "bulk-{段階}" | "generic" */
export type PackCategory = string;

export const PACK_GENERIC = "generic";
export const PACK_HIT = "hit";
/** 1 つの key に割り当てる最大本数（item:{id} と #2〜#5） */
export const PACK_MAX_VARIANTS = 5;
/** /api/se/upload と同じ制限 */
export const PACK_EXT_RE = /\.(mp3|ogg|wav|m4a|aac)$/i;
export const PACK_MAX_BYTES = 20 * 1024 * 1024;

export interface PackFile {
  name: string;
  /** フォルダ選択時の相対パス（webkitRelativePath）。無ければ name と同じ */
  relPath: string;
  size: number;
}

export interface PackItem {
  itemId: number;
  itemName: string;
  groups?: readonly string[] | null;
  patterns?: ReadonlyArray<{ patternId: number; isHit: boolean }> | null;
}

export interface PackAssignment {
  key: string;
  /** files の添字 */
  fileIndex: number;
}

export interface PackPlan {
  /** 分類 → 使えるファイルの添字（対象外のファイルは入らない） */
  categories: Record<PackCategory, number[]>;
  assignments: PackAssignment[];
  /** 割り当てで参照したファイルの添字（重複なし・昇順）。アップロードはこの分だけ */
  usedFiles: number[];
  skipped: Array<{ index: number; reason: string }>;
  itemsAssigned: number;
  itemsWithoutSound: number;
  hitPatternsAssigned: number;
  bulkGradesAssigned: number;
}

const bulkCategory = (g: BulkGrade) => `bulk-${g}`;

/** 英単語は語の境界で見る（"cool_fanfare" の cool には当てるが "coolant" には当てない）。日本語は含めば当てる */
function wordRe(en: readonly string[]): RegExp | null {
  return en.length > 0 ? new RegExp(`(^|[^a-z])(?:${en.join("|")})(?=[^a-z]|$)`, "i") : null;
}
function jpRe(jp: readonly string[]): RegExp | null {
  return jp.length > 0 ? new RegExp(jp.map((j) => j.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")) : null;
}

interface WordRule {
  cat: PackCategory;
  jp: RegExp | null;
  en: RegExp | null;
}
const rule = (cat: PackCategory, jp: readonly string[], en: readonly string[]): WordRule => ({ cat, jp: jpRe(jp), en: wordRe(en) });

/**
 * フォルダ名・ファイル名の言葉 → 分類。上から順に最初に当たったものを使う。
 * パチンコ・パチスロの用語（確定・告知・先バレ・プレミア・激アツ・リーチ…）は、自動ライブラリの近いテーマに寄せる
 */
const WORD_RULES: readonly WordRule[] = [
  rule(bulkCategory("MIRACLE"), ["ミラクル"], ["miracle"]),
  rule(bulkCategory("FANTASTIC"), ["ファンタスティック"], ["fantastic"]),
  rule(bulkCategory("GREAT"), ["グレート"], ["great"]),
  rule(bulkCategory("COOL"), ["クール"], ["cool"]),
  rule(PACK_HIT, ["大当", "当た", "当り", "あたり", "ボーナス", "ビッグ", "レギュラー"], ["atari", "hit", "bonus", "big", "reg"]),
  rule("jackpot", ["確定", "告知", "先バレ", "キュイン", "フィーバー", "ジャックポット"], ["kakutei", "kokuchi", "sakibare", "kyuin", "fever", "777", "jackpot"]),
  rule("epic", ["プレミア", "激アツ"], ["premium", "premier", "gekiatsu", "epic"]),
  rule("casino", ["リーチ", "予告", "チャンス", "突入", "演出"], ["reach", "yokoku", "chance", "casino"]),
  rule("fanfare", ["ファンファーレ"], ["fanfare"]),
  rule("win", ["勝利", "勝ち"], ["victory", "win"]),
  rule("cheer", ["歓声", "拍手"], ["cheer", "clap", "applause"]),
  rule("coin", ["コイン", "メダル", "払い出し"], ["coin", "medal", "payout"]),
  rule("sparkle", ["きらきら", "キラキラ"], ["sparkle"]),
  rule("notify", ["通知"], ["notify", "notification"]),
  rule("whoosh", ["風切"], ["whoosh", "swoosh"]),
  rule("laser", ["レーザー", "電撃"], ["laser"]),
  rule("explosion", ["爆発"], ["explosion", "boom"]),
  rule("thunder", ["雷"], ["thunder"]),
  rule("fire", ["炎"], ["fire", "flame"]),
  rule("pop", ["ポップ"], ["pop"]),
  // テーマ key そのもの（英語・語の境界）と THEME_LABELS の日本語（「とり・ひよこ」→ とり / ひよこ、「たぬき（ぽんぽこ）」→ たぬき）
  ...Object.entries(THEME_LABELS).map(([key, label]) =>
    rule(
      key,
      label
        .replace(/（.*?）/g, "")
        .split("・")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
      [key],
    ),
  ),
];

function categoryForWord(w: string): PackCategory | null {
  for (const r of WORD_RULES) if (r.jp?.test(w) || r.en?.test(w)) return r.cat;
  // 自動ライブラリのアイテム名の規則（ねこ・犬・花火…）をファイル名にも当てる
  return themeForItem(w);
}

/** 拡張子を除いたファイル名 */
function stem(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

/**
 * ファイルの分類。近いフォルダ名から順に見て、最後にファイル名。どれにも当たらなければ generic。
 * 例: "pack/花火/01.mp3" → fireworks、"se/kakutei_03.wav" → jackpot、"misc/a.mp3" → generic、"確定音/01.mp3" → jackpot
 */
export function classifyPackFile(relPath: string): PackCategory {
  const segs = relPath.split(/[\\/]/).filter((s) => s.length > 0);
  const file = segs.pop() ?? relPath;
  // 選んだフォルダそのもの（先頭）は最後に見る（"パチ音源" のような置き場の名前が先に当たらないように。
  // 「確定音」フォルダを直接選んだときは、ファイル名で決まらなければそのフォルダ名で決まる）
  const [root, ...sub] = segs;
  for (const f of sub.reverse()) {
    const c = categoryForWord(f);
    if (c) return c;
  }
  return categoryForWord(stem(file)) ?? (root !== undefined ? categoryForWord(root) : null) ?? PACK_GENERIC;
}

/** 分類の表示名 */
export function packCategoryLabel(cat: PackCategory): string {
  if (cat === PACK_GENERIC) return "分類なし（テーマの音が無いアイテムに使う）";
  if (cat === PACK_HIT) return "当たり";
  if (cat.startsWith("bulk-")) return `まとめ投げ ${BULK_GRADE_LABELS[cat.slice(5) as BulkGrade] ?? cat.slice(5)}`;
  return THEME_LABELS[cat] ?? cat;
}

/** 偏りの無い開始位置を id から決める（同じ入力なら同じ結果） */
function hash32(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

function rotate(pool: readonly number[], seed: number, n: number): number[] {
  if (pool.length === 0) return [];
  const take = Math.min(n, pool.length);
  const start = hash32(seed) % pool.length;
  return Array.from({ length: take }, (_, i) => pool[(start + i) % pool.length]);
}

function assignKeys(base: string, picks: readonly number[], out: PackAssignment[]): void {
  const keys = variantKeys(base);
  picks.forEach((fileIndex, i) => out.push({ key: keys[i], fileIndex }));
}

/**
 * 取り込み計画。アイテムごとにテーマの音を最大 maxVariants 本、当たりのパターンに hit の音、まとめ投げの段階に bulk-{段階} の音
 */
export function planPackImport(files: readonly PackFile[], items: readonly PackItem[], maxVariants = PACK_MAX_VARIANTS): PackPlan {
  const categories: Record<PackCategory, number[]> = {};
  const skipped: PackPlan["skipped"] = [];
  files.forEach((f, index) => {
    if (!PACK_EXT_RE.test(f.name)) {
      skipped.push({ index, reason: "mp3 / ogg / wav / m4a / aac 以外" });
      return;
    }
    if (f.size > PACK_MAX_BYTES) {
      skipped.push({ index, reason: `20MB 超（${(f.size / 1024 / 1024).toFixed(1)}MB）` });
      return;
    }
    const cat = classifyPackFile(f.relPath || f.name);
    (categories[cat] ??= []).push(index);
  });

  const isThemed = (cat: PackCategory) => cat !== PACK_GENERIC && cat !== PACK_HIT && !cat.startsWith("bulk-");
  const allThemed = Object.entries(categories)
    .filter(([cat]) => isThemed(cat))
    .flatMap(([, idx]) => idx)
    .sort((a, b) => a - b);
  const generic = categories[PACK_GENERIC] ?? [];
  const hit = categories[PACK_HIT] ?? [];

  const assignments: PackAssignment[] = [];
  let itemsAssigned = 0;
  let itemsWithoutSound = 0;
  let hitPatternsAssigned = 0;
  const seen = new Set<number>();
  for (const item of items) {
    if (seen.has(item.itemId)) continue;
    seen.add(item.itemId);
    const theme = themeForItem(item.itemName, item.groups);
    const pool = (theme && categories[theme]?.length ? categories[theme] : null) ?? (generic.length > 0 ? generic : allThemed);
    const picks = rotate(pool, item.itemId, maxVariants);
    if (picks.length === 0) itemsWithoutSound++;
    else {
      itemsAssigned++;
      assignKeys(`item:${item.itemId}`, picks, assignments);
    }
    if (hit.length > 0) {
      for (const p of item.patterns ?? []) {
        if (!p.isHit) continue;
        assignKeys(`pattern:${p.patternId}`, rotate(hit, p.patternId, maxVariants), assignments);
        hitPatternsAssigned++;
      }
    }
  }

  let bulkGradesAssigned = 0;
  MAIN_BULK_GRADES.forEach((g, i) => {
    const pool = categories[bulkCategory(g)];
    if (!pool || pool.length === 0) return;
    assignKeys(`bulk:${g}`, rotate(pool, i, maxVariants), assignments);
    bulkGradesAssigned++;
  });

  const usedFiles = [...new Set(assignments.map((a) => a.fileIndex))].sort((a, b) => a - b);
  return { categories, assignments, usedFiles, skipped, itemsAssigned, itemsWithoutSound, hitPatternsAssigned, bulkGradesAssigned };
}
