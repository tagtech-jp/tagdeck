// ギフトコメントの型と正規化（純関数のみ）。
// ブラウザ（LiveCockpit）とサーバ（live/poll）の両方から import するため、
// このファイルは lib/platforms/whowatch（device-id・UA・origin ヘッダ等のサーバ側実装）に依存しない。
// 依存を足すとクライアントバンドルにサーバ側の実装が引きずられるので、import は se/item-kind だけに保つこと。

import { patternKind, type ItemKind } from "../se/item-kind";

export interface LiveComment {
  id: number | string;
  comment_type: string;
  message?: string;
  play_item_pattern_id?: number;
  item_count?: number;
  anonymized?: boolean;
  posted_at?: number;
  user?: { id?: number | string; name?: string; user_path?: string; account_name?: string; icon_url?: string };
  [k: string]: unknown;
}

/**
 * ブラウザへ返すギフトコメント。LiveComment と違い未知フィールドを許さない閉じた型にしてある
 * （index signature があると `{...c}` のようなうっかりスプレッドが型チェックを通ってしまうため）。
 */
export interface PickedGiftComment {
  id: number | string;
  comment_type: string;
  message?: string;
  play_item_pattern_id?: number;
  item_count?: number;
  anonymized?: boolean;
  posted_at?: number;
  user?: { id?: number | string; name?: string; user_path?: string };
}

export interface PatternInfo {
  patternId: number;
  itemId: number | null;
  itemName: string | null;
  patternName: string | null;
  isHit: boolean;
  hitGrade: string | null;
  quantity: number | null;
  priceJpy: number | null;
  animationUrl: string | null;
  animationFullscreen: boolean;
  /** このアイテムが属するカテゴリ（アイテムページの並び順）。cat:group: の解決に使う */
  groups: string[];
}

/** 正規化ギフト（S1 仕様: pattern_id, item_id, count, is_hit, comment_id + 表示用） */
export interface NormalizedGift {
  comment_id: string;
  pattern_id: number | null;
  item_id: number | null;
  item_name: string | null;
  pattern_name: string | null;
  /** 個数 = コメントの item_count × パターンの quantity（「風船 × 10」のような束パターン）。合計金額 = price_yen × count */
  count: number;
  is_hit: boolean;
  hit_grade: string | null;
  /** 種類（通常/当たり/演出付き）。cat:kind の SE 解決に使う。パターン未登録なら null */
  kind: ItemKind | null;
  /** 1 個あたりの単価（whowatch_item_prices の unit_price_jpy。無ければ item_point_mapping.price_jpy） */
  price_yen: number | null;
  /** 1 回のコメントの合計金額 = price_yen × count。SE のティアはこれで判定する（まとめ投げは合計） */
  total_yen: number | null;
  /** このアイテムが属するカテゴリ（アイテムページの並び順）。cat:group: の解決に使う */
  groups: string[];
  message: string | null;
  posted_at: string | null;
  user: { id: string | null; name: string | null; user_path: string | null; anonymized: boolean };
}

/**
 * normalizeGift が実際に読むフィールドだけを持つ入力型。
 * サーバ側の LiveComment（未知フィールドを許す生データ）と、ブラウザへ渡す PickedGiftComment の
 * どちらもこの形を満たすので、正規化処理を両側で共有できる。
 */
export interface GiftCommentInput {
  id: number | string;
  /** normalizeGift は読まないが、呼び出し側は必ず持っているので受け取れるようにしておく */
  comment_type?: string;
  message?: string;
  play_item_pattern_id?: number;
  item_count?: number;
  anonymized?: boolean;
  posted_at?: number;
  user?: { id?: number | string; name?: string; user_path?: string };
}

export function isGiftComment(c: LiveComment): boolean {
  return c.comment_type === "BY_PLAYITEM";
}

/**
 * ブラウザへ返すギフトコメントを組み立てる（対策D: パターン照合をブラウザ側で行うため生データを渡す）。
 * 明示的に列挙したフィールドだけを写す。匿名ギフトの投げ主は、従来 normalizeGift がサーバ側で伏せていたので、
 * ここでも同じように落とす（伏せないと匿名のはずの ID・表示名がブラウザまで届いてしまう）。
 */
export function pickGiftComment(c: LiveComment): PickedGiftComment {
  return {
    id: c.id,
    comment_type: c.comment_type,
    message: c.message,
    play_item_pattern_id: c.play_item_pattern_id,
    item_count: c.item_count,
    anonymized: c.anonymized,
    posted_at: c.posted_at,
    user: c.anonymized || !c.user ? undefined : { id: c.user.id, name: c.user.name, user_path: c.user.user_path },
  };
}

export function normalizeGift(c: GiftCommentInput, lookup: (patternId: number) => PatternInfo | null): NormalizedGift {
  const patternId = typeof c.play_item_pattern_id === "number" ? c.play_item_pattern_id : null;
  const info = patternId !== null ? lookup(patternId) : null;
  const itemCount = typeof c.item_count === "number" && c.item_count > 0 ? c.item_count : 1;
  // 「風船 × 10」のような束パターンは quantity > 1。個数は item_count × quantity（合計金額の判定に使う）
  const perPattern = info?.quantity && info.quantity > 1 ? info.quantity : 1;
  const count = itemCount * perPattern;
  const anonymized = Boolean(c.anonymized);
  return {
    comment_id: String(c.id),
    pattern_id: patternId,
    item_id: info?.itemId ?? null,
    item_name: info?.itemName ?? null,
    pattern_name: info?.patternName ?? null,
    count,
    is_hit: info?.isHit ?? false,
    hit_grade: info?.hitGrade ?? null,
    kind: info ? patternKind({ isHit: info.isHit, animationUrl: info.animationUrl, animationFullscreen: info.animationFullscreen }) : null,
    price_yen: info?.priceJpy ?? null,
    total_yen: info?.priceJpy != null ? info.priceJpy * count : null,
    groups: info?.groups ?? [],
    message: typeof c.message === "string" ? c.message : null,
    posted_at: typeof c.posted_at === "number" ? new Date(c.posted_at).toISOString() : null,
    user: {
      id: anonymized ? null : c.user?.id != null ? String(c.user.id) : null,
      name: anonymized ? null : (c.user?.name ?? null),
      user_path: anonymized ? null : (c.user?.user_path ?? null),
      anonymized,
    },
  };
}
