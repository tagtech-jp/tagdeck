// 再生する音源を 1 つ決める（純関数・2026-09-29）。
//
// 優先順（S15）:
//   1. ユーザー／公式既定の個別行: bulk:item:{id}:{段階} → pattern:{id} → bulk:{段階} → item:{id}
//      同じ key の変種（key#2〜key#5）があればランダムに 1 本（鳴らす ON かつ音源あり。全部 OFF なら「鳴らさない」）
//      ただし公式既定の単発音（public/se/defaults/cc0/・S23/S24 で置き換えた CC0 の 1 音）の行は、有料で次のどれかなら飛ばして 2 のミックスにする
//      （2026-09-30 社長指示「160円以上のアイテムの SE をもっと 5 秒以上で組み合わせて豪華に」「主要なイベントアイテムはまとめ投げごとにさらに長い豪華な音に」
//      「花火系ももっと花火らしい綺羅びやかな長い SE に」・S25）: 単価 ¥160 以上 / まとめ投げの段階付き / 花火のテーマ。
//      音量はその行の音量を引き継ぐ。自分でアップロードした音源の行はこれまでどおり最優先
//   2. 自動ライブラリ（auto-library.ts）: 段階 → 当たり → アイテム名のテーマ（無料アイテムは控えめな音 lite-hit / lite-{テーマ}）。
//      単価 ¥160 以上は 5 秒以上の豪華版（p-{テーマ}）、主要なイベントアイテムと花火の段階は専用の長いミックス（ev-{テーマ}-{段階}）
//   3. ユーザー／公式既定の一括行: cat:group:{key} → cat:kind:{種類} → tier:{T0..T4|hit}（変種ランダム）
//   4. 自動ライブラリの価格帯の既定（tier-T0..T4 / hit）
//   5. null（engine.ts の合成音）
//
// 「明示的に無効化」は従来どおり: その段階の key に行があって全部 OFF なら何も鳴らさない（下位に落とさない）

import { chooseAutoForItem, chooseAutoForTier, FREE_AUTO_VOLUME, isPremiumPrice, THEME_LABELS, themeForItem } from "./auto-library";
import { clearedIdFromUrl } from "./cleared-defaults";
import type { BulkGrade } from "./bulk-grade";
import type { ItemKind } from "./item-kind";
import type { SeTier } from "./tiers";

/** 判定に要る最小の行の形（merge-defaults の MergedMapping と LiveConnectionProvider の Mapping の両方が満たす） */
export interface SoundRow {
  key: string;
  url: string | null;
  volume: number;
  enabled: boolean;
  label?: string | null;
  source?: "user" | "default";
}

export interface PlayTarget {
  patternId: number | null;
  itemId: number | null;
  itemName: string | null;
  tier: SeTier;
  isHit: boolean;
  kind?: ItemKind | null;
  groups?: readonly string[] | null;
  bulkGrade?: BulkGrade | null;
  /** 無料アイテム（単価 0・不明）。自動ライブラリは控えめな音にする（2026-09-30） */
  free?: boolean;
  /** 1 個あたりの単価（円）。¥160 以上は 5 秒以上の豪華版（S25）。null・未指定は判定しない */
  unitPriceYen?: number | null;
}

export interface SoundChoice {
  /** 鳴らす音源。null は合成音 */
  url: string | null;
  /** 0〜100 */
  volume: number;
  label: string | null;
  /** 決め手になった key（自動ライブラリはセット名）。合成音は null */
  key: string | null;
  source: "user" | "default" | "auto" | "synth";
  /** 自動ライブラリのテーマ（表示用） */
  theme: string | null;
}

/** 変種 key の基底（"item:1#3" → "item:1"）。`#2`〜`#5` だけを変種として扱う */
export function baseKey(key: string): string {
  return key.replace(/#[2-5]$/, "");
}

export function variantKeys(base: string): string[] {
  return [base, `${base}#2`, `${base}#3`, `${base}#4`, `${base}#5`];
}

type Grouped = Map<string, SoundRow[]>;

export function groupByBase(mappings: readonly SoundRow[]): Grouped {
  const g: Grouped = new Map();
  for (const m of mappings) {
    const b = baseKey(m.key);
    const list = g.get(b) ?? [];
    list.push(m);
    g.set(b, list);
  }
  return g;
}

/** base key の行から 1 本選ぶ。行が無ければ undefined、全部 OFF なら null（鳴らさない） */
function pickFromRows(rows: SoundRow[] | undefined, rand: () => number): SoundRow | null | undefined {
  if (!rows || rows.length === 0) return undefined;
  const enabled = rows.filter((r) => r.enabled);
  if (enabled.length === 0) return null;
  // 音源ありを優先（url null の行だけなら「既定（合成音）」の意味なので 1 本目を返す）
  const withUrl = enabled.filter((r) => r.url);
  const pool = withUrl.length > 0 ? withUrl : enabled;
  return pool[Math.floor(rand() * pool.length)] ?? pool[0];
}

function toChoice(m: SoundRow): SoundChoice {
  return { url: m.url, volume: m.volume, label: m.label ?? null, key: m.key, source: m.source ?? "user", theme: null };
}

const DISABLED: unique symbol = Symbol("disabled");

/** 公式既定の単発音（S23/S24 で置き換えた CC0 の 1 音）の行か。自分でアップロードした音源・ライブラリの音は false */
export function isClearedSingleRow(r: Pick<SoundRow, "url">): boolean {
  return clearedIdFromUrl(r.url) !== null;
}

function tryKeys(grouped: Grouped, keys: readonly string[], rand: () => number, skip?: (r: SoundRow) => boolean, skipped?: SoundRow[]): SoundChoice | typeof DISABLED | null {
  for (const k of keys) {
    let rows = grouped.get(k);
    if (rows && skip) {
      // 鳴らす ON の単発音だけ飛ばす（OFF の行は「鳴らさない」の意味なので残す）
      const drop = rows.filter((r) => r.enabled && skip(r));
      if (drop.length > 0) {
        skipped?.push(...drop);
        rows = rows.filter((r) => !drop.includes(r));
      }
    }
    const r = pickFromRows(rows, rand);
    if (r === undefined) continue;
    if (r === null) return DISABLED;
    return toChoice(r);
  }
  return null;
}

/**
 * 公式既定の単発音の行を飛ばしてミックスにするか（S25）。有料で、単価 ¥160 以上 / まとめ投げの段階付き / 花火のテーマ のどれか
 */
export function upgradesClearedSingles(t: PlayTarget): boolean {
  if (t.free) return false;
  if (isPremiumPrice(t.unitPriceYen)) return true;
  if (t.bulkGrade) return true;
  return themeForItem(t.itemName, t.groups) === "fireworks";
}

/** @returns SoundChoice。"disabled" は明示的に鳴らさない */
export function chooseSound(mappings: readonly SoundRow[], t: PlayTarget, rand: () => number = Math.random): SoundChoice | "disabled" {
  const grouped = groupByBase(mappings);
  const specific: string[] = [];
  if (t.bulkGrade && t.itemId !== null) specific.push(`bulk:item:${t.itemId}:${t.bulkGrade}`);
  if (t.patternId !== null) specific.push(`pattern:${t.patternId}`);
  if (t.bulkGrade) specific.push(`bulk:${t.bulkGrade}`);
  if (t.itemId !== null) specific.push(`item:${t.itemId}`);
  const premium = !t.free && isPremiumPrice(t.unitPriceYen);
  const skipped: SoundRow[] = [];
  const s1 = tryKeys(grouped, specific, rand, upgradesClearedSingles(t) ? isClearedSingleRow : undefined, skipped);
  if (s1 === DISABLED) return "disabled";
  if (s1) return s1;
  // 飛ばした単発音の行の音量（ユーザーが音量だけ変えていればそれを引き継ぐ）
  const hintVolume = skipped[0]?.volume;

  const auto = chooseAutoForItem({ itemName: t.itemName, groups: t.groups, tier: t.tier, isHit: t.isHit, bulkGrade: t.bulkGrade, free: t.free, premium }, rand);
  // 無料アイテムの控えめな音は音量も一段小さく（FREE_AUTO_VOLUME）
  if (auto) return { url: auto.file.file, volume: t.free ? FREE_AUTO_VOLUME : (hintVolume ?? 80), label: auto.file.title, key: auto.set, source: "auto", theme: auto.theme };

  const generic: string[] = [];
  for (const g of t.groups ?? []) generic.push(`cat:group:${g}`);
  if (t.kind) generic.push(`cat:kind:${t.kind}`);
  const s3 = tryKeys(grouped, generic, rand);
  if (s3 === DISABLED) return "disabled";
  if (s3) return s3;

  // 価格帯（2026-09-29 社長指示「既定の SE も素材から」）: 自分で上げた tier 行だけを優先し、
  // 公式既定（旧音源・きらきら汎用）の tier 行は素材ライブラリの価格帯セット（5 本ランダム）に置き換える。
  // 音量・「鳴らす」だけ変えた自分の行（url null）は、その音量でライブラリを鳴らす
  const tierKey = `tier:${t.tier}`;
  const tierRows = grouped.get(tierKey)?.filter((r) => r.source !== "default");
  const own = pickFromRows(tierRows, rand);
  if (own === null) return "disabled";
  if (own && own.url) return toChoice(own);
  const autoTier = chooseAutoForTier(t.tier, rand, premium);
  if (autoTier) return { url: autoTier.file.file, volume: own?.volume ?? hintVolume ?? (t.free ? FREE_AUTO_VOLUME : 80), label: autoTier.file.title, key: autoTier.set, source: "auto", theme: null };
  // ライブラリに価格帯セットが無い（通常は無い）ときだけ旧来の既定行
  const legacy = tryKeys(grouped, [tierKey], rand);
  if (legacy === DISABLED) return "disabled";
  if (legacy) return legacy;
  return { url: null, volume: 80, label: null, key: null, source: "synth", theme: null };
}

export function describeChoice(c: SoundChoice | "disabled"): string {
  if (c === "disabled") return "鳴らさない（無効化）";
  if (c.source === "auto") return `自動: ${c.theme ? (THEME_LABELS[c.theme] ?? c.theme) : c.key} / ${c.label ?? ""}`;
  if (c.source === "synth") return "合成音";
  return `${c.source === "user" ? "自分" : "公式既定"}: ${c.key} / ${c.label ?? ""}`;
}
