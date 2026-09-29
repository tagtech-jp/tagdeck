// 再生する音源を 1 つ決める（純関数・2026-09-29）。
//
// 優先順（S15）:
//   1. ユーザー／公式既定の個別行: bulk:item:{id}:{段階} → pattern:{id} → bulk:{段階} → item:{id}
//      同じ key の変種（key#2〜key#5）があればランダムに 1 本（鳴らす ON かつ音源あり。全部 OFF なら「鳴らさない」）
//   2. 自動ライブラリ（auto-library.ts）: 段階 → 当たり → アイテム名のテーマ（無料アイテムは控えめな音 lite-hit / lite-{テーマ}）
//   3. ユーザー／公式既定の一括行: cat:group:{key} → cat:kind:{種類} → tier:{T0..T4|hit}（変種ランダム）
//   4. 自動ライブラリの価格帯の既定（tier-T0..T4 / hit）
//   5. null（engine.ts の合成音）
//
// 「明示的に無効化」は従来どおり: その段階の key に行があって全部 OFF なら何も鳴らさない（下位に落とさない）

import { chooseAutoForItem, chooseAutoForTier, THEME_LABELS } from "./auto-library";
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

function tryKeys(grouped: Grouped, keys: readonly string[], rand: () => number): SoundChoice | typeof DISABLED | null {
  for (const k of keys) {
    const r = pickFromRows(grouped.get(k), rand);
    if (r === undefined) continue;
    if (r === null) return DISABLED;
    return toChoice(r);
  }
  return null;
}

/** @returns SoundChoice。"disabled" は明示的に鳴らさない */
export function chooseSound(mappings: readonly SoundRow[], t: PlayTarget, rand: () => number = Math.random): SoundChoice | "disabled" {
  const grouped = groupByBase(mappings);
  const specific: string[] = [];
  if (t.bulkGrade && t.itemId !== null) specific.push(`bulk:item:${t.itemId}:${t.bulkGrade}`);
  if (t.patternId !== null) specific.push(`pattern:${t.patternId}`);
  if (t.bulkGrade) specific.push(`bulk:${t.bulkGrade}`);
  if (t.itemId !== null) specific.push(`item:${t.itemId}`);
  const s1 = tryKeys(grouped, specific, rand);
  if (s1 === DISABLED) return "disabled";
  if (s1) return s1;

  const auto = chooseAutoForItem({ itemName: t.itemName, groups: t.groups, tier: t.tier, isHit: t.isHit, bulkGrade: t.bulkGrade, free: t.free }, rand);
  if (auto) return { url: auto.file.file, volume: 80, label: auto.file.title, key: auto.set, source: "auto", theme: auto.theme };

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
  const autoTier = chooseAutoForTier(t.tier, rand);
  if (autoTier) return { url: autoTier.file.file, volume: own?.volume ?? 80, label: autoTier.file.title, key: autoTier.set, source: "auto", theme: null };
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
