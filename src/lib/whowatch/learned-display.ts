// SE タブに出す「実収の単価」（運営者だけ・純関数・2026-10-06 社長指示）。
//
// item_point_mapping.learned_point は、erupi-commentbot が /present（配信者本人の獲得ポイント）の増え方から学習した
// 「アイテム 1 個で実際に受け取ったポイント」（drizzle/0023）。運営者の実際の収益の比率なので、items/patterns ルートは
// 運営者（EXPORT_OWNER_USER_ID）のときだけ、この関数の結果を付ける。
// 未学習のアイテムは、学習済みの有料アイテムの「学習した単価 ÷ 定価」の中央値 × 定価 を見込みとして出す。

export interface LearnedRow {
  itemId: string;
  whowatchId: number;
  learnedPoint: number | null;
  learnedSamples: number | null;
}
export interface LearnedInfo {
  point: number;
  samples: number;
}
export interface LearnedFields {
  /** 学習した 1 個の単価（pt）。未学習は null */
  learnedPoint: number | null;
  /** 観測回数（未学習は 0） */
  learnedSamples: number;
  /** 未学習のときの見込み（定価 × 学習済みの比率・pt）。学習済み・定価が無い・比率が無いときは null */
  estimatedPoint: number | null;
}

/** 数値の item_id → 学習値。同じ数値 id の行（日次同期の行と旧シード行）が複数あれば観測回数の多い方 */
export function learnedById(rows: readonly LearnedRow[]): Map<number, LearnedInfo> {
  const out = new Map<number, LearnedInfo>();
  for (const r of rows) {
    if (r.learnedPoint === null || r.learnedPoint === undefined) continue;
    const id = r.whowatchId > 0 ? r.whowatchId : /^\d+$/.test(r.itemId) ? Number(r.itemId) : null;
    if (id === null) continue;
    const info = { point: Number(r.learnedPoint), samples: Number(r.learnedSamples ?? 0) };
    const cur = out.get(id);
    if (!cur || info.samples > cur.samples) out.set(id, info);
  }
  return out;
}

/** 学習した単価 ÷ 定価 の中央値（どちらも 0 より大きいアイテムだけ）。無ければ null */
export function learnedRatio(learned: ReadonlyMap<number, LearnedInfo>, priceOf: (itemId: number) => number | null): number | null {
  const rs: number[] = [];
  for (const [id, info] of learned) {
    const price = priceOf(id);
    if (price !== null && price > 0 && info.point > 0) rs.push(info.point / price);
  }
  if (rs.length === 0) return null;
  rs.sort((a, b) => a - b);
  const mid = Math.floor(rs.length / 2);
  return rs.length % 2 === 1 ? rs[mid] : (rs[mid - 1] + rs[mid]) / 2;
}

/** 1 アイテム分の表示用の値 */
export function learnedFieldsFor(itemId: number, priceJpy: number | null, learned: ReadonlyMap<number, LearnedInfo>, ratio: number | null): LearnedFields {
  const info = learned.get(itemId);
  if (info) return { learnedPoint: info.point, learnedSamples: info.samples, estimatedPoint: null };
  const estimatedPoint = ratio !== null && priceJpy !== null && priceJpy > 0 ? Math.round(priceJpy * ratio) : null;
  return { learnedPoint: null, learnedSamples: 0, estimatedPoint };
}

/** 運営者か（EXPORT_OWNER_USER_ID は users.id ＝ auth.users.id）。未設定なら誰も運営者ではない */
export function isOwner(userId: string | null | undefined, ownerId: string | undefined): boolean {
  return Boolean(userId && ownerId && userId === ownerId);
}
