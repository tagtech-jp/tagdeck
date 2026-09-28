// まとめ投げの段階（クール / グレート / ファンタスティック / ミラクル）。2026-09-28 社長指示
// 「イベントアイテムなどのまとめ投げしたときのクール・グレート・ファンタスティック・ミラクルも個別に設定できるようにしたい」。
//
// 解析結果（2026-09-28）:
// - ギフトコメントは「基本パターンの pattern_id + item_count」で届く（例: 10643 × item_count 3）。段階名は API のコメントに無い
// - 段階はふわっち本体（whowatch.tv chunk-C4NMZPGA.js の setGradeImagePath）がアイテムごとのしきい値から決めている:
//     gradeMaxSortedArray = (custom_pattern_decorations + pattern_decorations) を count の降順に並べ、
//     最初に count <= 投げた個数 を満たすものが段階（COOL / GREAT / FANTASTIC / MIRACLE / TAMAYA / NYANDERFUL / WONDERFUL / KP）
// - しきい値は `GET /lives/{id}/playitems3`（認証不要）の user_retain_items[].patterns[0].pattern_decorations にある。
//   実測（2026-09-28 本番同期・88 アイテム中 86 にしきい値）: 釣り竿 COOL 25・GREAT 50・FANTASTIC 100・MIRACLE 200 /
//         花火 COOL 2・GREAT 5・FANTASTIC 10 / ぶたさん・ゾウ（イベント応援）COOL 15・GREAT 45・FANTASTIC 100 / 投票券・サイコロ なし
//   認証なしの playitems3 に載るのは購入できるアイテムだけ。イベントの無料配布（バスケット・どんぐり等）は載らないが、
//   それらは pattern_limit=3（1 回に 3 個まで）なので、そもそもまとめ投げの段階が付かない
// - `_x5` `_x10` `_x20` の画像を持つ別パターンは**まとめ投げではなく「5 倍・10 倍・20 倍」の当たり**（コメント本文も「【10倍】…」）。
//   これは別の pattern_id で届くので当たりとして個別に扱う（item-patterns-sync.ts の estimateHit）
//
// 個数はコメントの item_count（束パターンの quantity は掛けない。ふわっちの presentCount と同じ）。
// このファイルはブラウザでも使うため、サーバ側のモジュールに依存しない。

export type BulkGrade = "COOL" | "GREAT" | "FANTASTIC" | "MIRACLE" | "TAMAYA" | "NYANDERFUL" | "WONDERFUL" | "KP";

export const BULK_GRADES: readonly BulkGrade[] = ["COOL", "GREAT", "FANTASTIC", "MIRACLE", "TAMAYA", "NYANDERFUL", "WONDERFUL", "KP"];

/** SE タブに行を出す主要 4 段階（他はイベント限定の変種。現行アイテムの実測では出ていない） */
export const MAIN_BULK_GRADES: readonly BulkGrade[] = ["COOL", "GREAT", "FANTASTIC", "MIRACLE"];

export const BULK_GRADE_LABELS: Record<BulkGrade, string> = {
  COOL: "クール",
  GREAT: "グレート",
  FANTASTIC: "ファンタスティック",
  MIRACLE: "ミラクル",
  TAMAYA: "たまや",
  NYANDERFUL: "ニャンダフル",
  WONDERFUL: "ワンダフル",
  KP: "KP",
};

export interface BulkDecoration {
  /** この個数以上で段階が付く */
  count: number;
  grade: BulkGrade;
}

export function isBulkGrade(v: unknown): v is BulkGrade {
  return typeof v === "string" && (BULK_GRADES as readonly string[]).includes(v);
}

/**
 * API の pattern_decorations（[{count, pattern_decoration}]）を段階の配列にする。
 * custom_pattern_decorations（画像だけで段階名が無いもの）は名前が付けられないので落とす。
 * 同じ段階が複数あれば小さい count を採る。count の昇順で返す
 */
export function parseDecorations(raw: unknown): BulkDecoration[] {
  if (!Array.isArray(raw)) return [];
  const byGrade = new Map<BulkGrade, number>();
  for (const d of raw) {
    if (!d || typeof d !== "object") continue;
    const o = d as { count?: unknown; pattern_decoration?: unknown; grade?: unknown };
    const grade = isBulkGrade(o.pattern_decoration) ? o.pattern_decoration : isBulkGrade(o.grade) ? o.grade : null;
    const count = typeof o.count === "number" && Number.isFinite(o.count) && o.count > 0 ? Math.floor(o.count) : null;
    if (!grade || count === null) continue;
    const cur = byGrade.get(grade);
    if (cur === undefined || count < cur) byGrade.set(grade, count);
  }
  return [...byGrade].map(([grade, count]) => ({ count, grade })).sort((a, b) => a.count - b.count);
}

/** ふわっち本体と同じ判定: count の降順で最初に count <= 個数 を満たす段階。該当なし・しきい値なしは null */
export function bulkGradeFor(decorations: readonly BulkDecoration[] | null | undefined, itemCount: number): BulkGrade | null {
  if (!decorations || decorations.length === 0) return null;
  const n = Number.isFinite(itemCount) ? Math.floor(itemCount) : 0;
  const hit = [...decorations].sort((a, b) => b.count - a.count).find((d) => d.count <= n);
  return hit ? hit.grade : null;
}

/** se_mappings の key。bulk:{段階} = 全アイテム共通 / bulk:item:{item_id}:{段階} = アイテム別 */
export const bulkKey = (grade: BulkGrade) => `bulk:${grade}`;
export const bulkItemKey = (itemId: number, grade: BulkGrade) => `bulk:item:${itemId}:${grade}`;

/** API ルートの KEY_RE に組み込む断片（mappings / upload で共通） */
export const BULK_KEY_RE_SOURCE = "bulk:(?:item:\\d{1,10}:)?(?:COOL|GREAT|FANTASTIC|MIRACLE|TAMAYA|NYANDERFUL|WONDERFUL|KP)";

/** 「クール 25個〜 / グレート 50個〜 …」のような表示文字列 */
export function describeDecorations(decorations: readonly BulkDecoration[] | null | undefined): string {
  if (!decorations || decorations.length === 0) return "";
  return [...decorations]
    .sort((a, b) => a.count - b.count)
    .map((d) => `${BULK_GRADE_LABELS[d.grade]} ${d.count}個〜`)
    .join(" / ");
}
