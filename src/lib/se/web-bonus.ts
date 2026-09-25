// SE タブの擬似カテゴリ「WEBおまけ・無料アイテム」（2026-09-26）。
// ふわっちの /playitems にはおまけ・無料の区分が無く（価格が無いだけ）、価格なしアイテムは 1,787 件あって
// 「分類なし」からネズミやメガホンを探すのが大変だった。名前で束ねて 1 つのカテゴリとして出す。
// 判定は名前の正規表現（社長指示: ネズミ・メガホン を含む）。価格があるものは除く（同名の有料版はアイテムページのカテゴリ側に出る）

export const WEB_BONUS_GROUP = "webbonus";
export const WEB_BONUS_LABEL = "WEBおまけ・無料アイテム（ネズミ・メガホン・ハートなど）";

/** おまけ・無料配布としてよく配られるアイテムの名前 */
export const WEB_BONUS_RE = /メガホン|ネズミさん|ハート|拍手|\(Web\)|（Web）/;

export function isWebBonusItem(item: { itemName: string; priceJpy: number | null }): boolean {
  return item.priceJpy === null && WEB_BONUS_RE.test(item.itemName);
}
