// アイテムの種類（SE タブの仕分け軸）。約 1,900 件のアイテムを 3 つに分ける。
//   当たり   : is_hit（パターン名からの推定。item-patterns-sync.ts の estimateHit）
//   演出付き : animation_url（= API の animation_url2）か animation_fullscreen のどちらか
//              ※ 全画面演出だけで animation_url2 を持たないパターンが実測で 286/334 あるため両方を見る
//   通常     : 上記以外

export type ItemKind = "normal" | "hit" | "anim";

export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  normal: "通常",
  hit: "当たり",
  anim: "演出付き",
};

export interface KindSource {
  isHit: boolean;
  animationUrl?: string | null;
  animationFullscreen?: boolean;
}

export function patternKind(p: KindSource): ItemKind {
  if (p.isHit) return "hit";
  if (p.animationUrl || p.animationFullscreen) return "anim";
  return "normal";
}

/** アイテムの種類。パターンのいずれかが該当すれば当たり > 演出付き > 通常 の順に昇格する */
export function itemKind(patterns: KindSource[]): ItemKind {
  let kind: ItemKind = "normal";
  for (const p of patterns) {
    const k = patternKind(p);
    if (k === "hit") return "hit";
    if (k === "anim") kind = "anim";
  }
  return kind;
}
