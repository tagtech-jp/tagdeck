// SE タブのアイテム画像（純関数）。
// /playitems のパターンごとに image_url があるが、アイテム 1 件に画像 1 枚あれば足りる。
// 4,431 パターン分の URL を全部返すと応答が重い（2026-09-22 の 1.35MB 障害）ので、
// アイテムを代表する 1 枚だけを選んで返す。

export interface ImagePatternLike {
  patternName: string;
  imageUrl: string | null;
  isHit: boolean;
}

/**
 * アイテムを代表する画像を 1 枚選ぶ。
 * 優先順: アイテム名と同じ名前の通常パターン（素の絵柄）→ 当たりでない最初の画像 → どれでも最初の画像。
 * 画像が 1 つも無ければ null（SE タブは画像なしのカードで表示する）
 */
export function pickItemImage(itemName: string, patterns: ImagePatternLike[]): string | null {
  const withImage = patterns.filter((p) => typeof p.imageUrl === "string" && p.imageUrl.trim() !== "");
  if (withImage.length === 0) return null;
  const plain = withImage.find((p) => p.patternName === itemName && !p.isHit);
  if (plain) return plain.imageUrl!.trim();
  const nonHit = withImage.find((p) => !p.isHit);
  return (nonHit ?? withImage[0]).imageUrl!.trim();
}
