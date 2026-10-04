// 配信者が実際に受け取ったポイントから学習した「アイテム 1 個の単価」の受け取り（純関数・2026-10-04）。
//
// 背景（社長指示「アイテムが飛ぶたびに 1 個の単価を割り出して学習していってほしい。tagdeck にもその結果を反映してほしい」）:
//   item_point_mapping.price_jpy は定価（円）で、配信者が実際に受け取る whowatch のポイントとは一致しない。
//   erupi-commentbot（D:/tagtech/projects/erupi-commentbot）が https://whowatch.tv/present（配信者本人でログイン）の
//   獲得ポイントとアイテムの個数の増え方から 1 個あたりのポイントを割り出し（観測の中央値）、
//   POST /api/platforms/whowatch/items/learned に送る。社長決定（2026-10-04）: 既存の単価表に列を足す（B 案・drizzle/0023）
//
// 本文: { items: [{ item_id: "10773", learned_point: 80, samples: 3 }, …] }（最大 LEARNED_MAX_ITEMS 件）
//   item_id        数値の item_id（play_item_id と同じ）。単価表の数値の item_id の行と、同じ数値を whowatch_id に持つ旧シード行の両方に当てる
//   learned_point  1 個あたりのポイント（0 以上。無料アイテムは 0）
//   samples        観測回数（1 以上）

import { z } from "zod";

export const LEARNED_MAX_ITEMS = 500;

const itemSchema = z.object({
  item_id: z.string().regex(/^[1-9]\d{0,8}$/),
  learned_point: z.number().finite().min(0).max(10_000_000),
  samples: z.number().int().min(1).max(1_000_000),
});
const bodySchema = z.object({ items: z.array(itemSchema).max(LEARNED_MAX_ITEMS) });

export interface LearnedItem {
  itemId: string;
  learnedPoint: number;
  samples: number;
}

export type LearnedParseResult = { ok: true; items: LearnedItem[] } | { ok: false; error: string };

/** 本文を検査する。本文が無いとき（null）は 0 件として受け付ける。同じ item_id が重なったら後の方を使う。単価は小数第 2 位に丸める */
export function parseLearnedBody(body: unknown): LearnedParseResult {
  if (body === null || body === undefined) return { ok: true, items: [] };
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: `items は [{ item_id: 数字の文字列, learned_point: 0 以上の数, samples: 1 以上の整数 }]（最大 ${LEARNED_MAX_ITEMS} 件）` };
  }
  const byId = new Map<string, LearnedItem>();
  for (const it of parsed.data.items) {
    byId.set(it.item_id, { itemId: it.item_id, learnedPoint: Math.round(it.learned_point * 100) / 100, samples: it.samples });
  }
  return { ok: true, items: [...byId.values()] };
}

/** UPDATE … FROM jsonb_to_recordset(…) に渡す JSON（id: 文字列の item_id・num: 数値の item_id） */
export function toRecordsetJson(items: readonly LearnedItem[]): string {
  return JSON.stringify(items.map((i) => ({ id: i.itemId, num: Number(i.itemId), point: i.learnedPoint, samples: i.samples })));
}

export interface UpdatedRow {
  item_id: string;
  whowatch_id: number;
  learned_point: number | null;
  learned_samples: number;
}
export interface LearnedUpdateSummary {
  /** 書けた item_id ごとの、書いた後の値（RETURNING）と更新した行数 */
  updated: Array<{ item_id: string; learned_point: number | null; learned_samples: number; rows: number }>;
  /** 単価表に行が無かった item_id（行は作らない） */
  missing: string[];
}

/** RETURNING の行と送られてきた item_id を突き合わせる。値は数値の item_id の行を優先して返す */
export function summarizeUpdate(items: readonly LearnedItem[], rows: readonly UpdatedRow[]): LearnedUpdateSummary {
  const updated: LearnedUpdateSummary["updated"] = [];
  const missing: string[] = [];
  for (const it of items) {
    const num = Number(it.itemId);
    const hit = rows.filter((r) => r.item_id === it.itemId || (r.whowatch_id > 0 && Number(r.whowatch_id) === num));
    if (hit.length === 0) {
      missing.push(it.itemId);
      continue;
    }
    const main = hit.find((r) => r.item_id === it.itemId) ?? hit[0];
    updated.push({
      item_id: it.itemId,
      learned_point: main.learned_point === null ? null : Number(main.learned_point),
      learned_samples: Number(main.learned_samples),
      rows: hit.length,
    });
  }
  return { updated, missing };
}
