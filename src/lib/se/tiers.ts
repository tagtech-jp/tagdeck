// S1: SE のティア判定（純関数）。価格帯・当たり・連投で既定音を決める。
// 既定パックは Web Audio 合成（権利問題なし）。ユーザーの se_mappings が優先される。

import type { ItemKind } from "./item-kind";

export type SeTier = "T0" | "T1" | "T2" | "T3" | "T4" | "hit";

export interface TierInput {
  /** 1 個あたりの円（無料・不明は 0/null） */
  priceYen: number | null;
  count: number;
  isHit: boolean;
}

/** 価格帯（1 回の投げ銭の合計 = 単価 × 個数）で T0〜T4。当たりは hit を優先 */
export function tierForGift(g: TierInput): SeTier {
  if (g.isHit) return "hit";
  const total = (g.priceYen ?? 0) * Math.max(1, g.count);
  if (total <= 0) return "T0";
  if (total < 500) return "T1";
  if (total < 2000) return "T2";
  if (total < 5000) return "T3";
  return "T4";
}

export const TIER_LABELS: Record<SeTier, string> = {
  T0: "無料（ポップ）",
  T1: "〜¥499（チャイム・短）",
  T2: "¥500〜1,999（チャイム）",
  T3: "¥2,000〜4,999（ファンファーレ・短）",
  T4: "¥5,000〜（ファンファーレ）",
  hit: "当たり（ジングル）",
};

/**
 * se_mappings の key を pattern:{id} → item:{id} → cat:group:{key} → cat:kind:{種類} → tier:{T0..}
 * の順で解決する。個別（pattern / item）がカテゴリ一括（cat:）より常に優先される。
 *
 * groups は「そのアイテムが属するカテゴリ」。ふわっちでは 1 アイテムが複数カテゴリに同時所属する
 * （例: イベント応援セール かつ オータムグッズ かつ 配信の番長）ため配列で受け、
 * アイテムページの並び順（display_order）に並べたまま渡された順で最初に見つかったものを使う。
 */
export function resolveMappingKey(
  keys: Set<string>,
  g: { patternId: number | null; itemId: number | null; tier: SeTier; kind?: ItemKind | null; groups?: readonly string[] | null },
): string | null {
  if (g.patternId !== null && keys.has(`pattern:${g.patternId}`)) return `pattern:${g.patternId}`;
  if (g.itemId !== null && keys.has(`item:${g.itemId}`)) return `item:${g.itemId}`;
  for (const group of g.groups ?? []) {
    if (keys.has(`cat:group:${group}`)) return `cat:group:${group}`;
  }
  if (g.kind && keys.has(`cat:kind:${g.kind}`)) return `cat:kind:${g.kind}`;
  if (keys.has(`tier:${g.tier}`)) return `tier:${g.tier}`;
  return null;
}
