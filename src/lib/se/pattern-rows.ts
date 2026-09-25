// SE タブで「パターン単位の個別割り当て」を出す条件。
//
// 実測（2026-09-22 /playitems の実応答）:
// - 演出付きで複数パターンを持つアイテム 54 件のうち 38 件は、全パターンが name も quantity も
//   animation も完全に同一だった（例: 水上花火は 17 パターンすべて同一。違うのは pattern_id だけ）。
//   こういうアイテムでパターン行を並べても、見分けがつかず選びようがない。
// - 残り 16 件は名前やアニメーションが実際に異なる（例: あるボーナス系は 9 パターンで 9 種類の名前）。
//   これは別々の音を割り当てる意味がある。
//
// そこで「名前で区別できるか」を条件にする。同じ名前のパターンが複数 pattern_id に散っている場合は
// 1 行にまとめ、割り当ては その名前が持つ全 pattern_id へ書く（どれが飛んできても同じ音が鳴る）。

export interface PatternLike {
  patternId: number;
  patternName: string;
  isHit: boolean;
}

export interface PatternRowGroup<T extends PatternLike> {
  /** 表示名（＝ pattern_name） */
  label: string;
  /** この名前を持つ全パターン。SE はこの全部に同じ割り当てを書く */
  patternIds: number[];
  isHit: boolean;
  /** 種類バッジなどの表示に使う代表パターン */
  representative: T;
}

/**
 * 個別に SE を割り当てる価値があるパターンだけを、名前ごとにまとめて返す。
 *
 * 出す条件:
 *   (a) 当たり … 特別な音を鳴らす意味があるので常に出す
 *   (b) アイテム内に 2 種類以上の pattern_name があり、かつアイテム名と違う名前
 *       … 「違いが名前に出ている」ものだけ。アイテム名と同じ名前は素の絵柄でアイテム行と重複するため出さない
 */
export function expandablePatternRows<T extends PatternLike>(itemName: string, patterns: T[]): PatternRowGroup<T>[] {
  const byName = new Map<string, PatternRowGroup<T>>();
  for (const p of patterns) {
    const cur = byName.get(p.patternName);
    if (cur) {
      cur.patternIds.push(p.patternId);
      if (p.isHit && !cur.isHit) {
        cur.isHit = true;
        cur.representative = p;
      }
    } else {
      byName.set(p.patternName, { label: p.patternName, patternIds: [p.patternId], isHit: p.isHit, representative: p });
    }
  }
  const distinctNames = byName.size;
  return [...byName.values()].filter((g) => g.isHit || (distinctNames > 1 && g.label !== itemName));
}
