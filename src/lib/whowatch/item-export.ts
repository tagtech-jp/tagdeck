// item_point_mapping を外部ツール（tagtech-OBS の単価表）向けに書き出す形に整える（純関数・2026-09-28）。
//
// 背景（社長指示「item_point_mapping にイベント限定アイテムが漏れている」）: tagtech-OBS は社長が Supabase から手で
// CSV 書き出しした単価表を読んでいたため、イベント開始後に追加されたアイテムが反映されなかった。
// GET /api/platforms/whowatch/items/export がこの関数の結果を返し、OBS 側は起動時に取りに来る。
//
// 列の意味:
//   price_jpy   1 個あたりの定価（円・まとめ買い割引前）。無料配布（state=FREE）は 0
//   purchasable 買えるアイテムか（state が FREE でなく、定価の元になった商品がある）
//   event_key / event_id  所属するイベント。whowatch_item_groups.event_key（無料配布行に入る）→ 無ければ
//               カテゴリ key を whowatch_events.item_group_key で逆引き（有料行の event_key が null のままになる
//               既存の不具合 syncItemGroups の回避）。どちらも無ければ null（恒常アイテム）
//   group_keys  所属カテゴリ（アイテムページの並び順）
//   on_sale     state=OPEN

export interface ExportMappingRow {
  itemId: string;
  itemName: string;
  priceJpy: number;
  productId: string;
  state: string;
  whowatchId: number;
  lastFetchedAt: Date | string | null;
}
export interface ExportGroupRow {
  itemId: number;
  groupKey: string;
  eventKey: string | null;
  isFree: boolean;
  displayOrder: number | null;
}
export interface ExportEventRow {
  id: number;
  eventKey: string;
  itemGroupKey: string | null;
  status: string;
}
export interface ExportItem {
  item_id: string;
  item_name: string;
  price_jpy: number;
  purchasable: boolean;
  event_id: number | null;
  event_key: string | null;
  group_keys: string[];
  state: string;
  on_sale: boolean;
  last_fetched_at: string | null;
}

const STATUS_RANK: Record<string, number> = { open: 3, pre: 2, closed: 1 };

/** 数値の item_id（play_item_id と同じ）。whowatch_id が無ければ item_id を数値として読む */
export function numericItemId(r: Pick<ExportMappingRow, "itemId" | "whowatchId">): number | null {
  if (r.whowatchId > 0) return r.whowatchId;
  return /^\d+$/.test(r.itemId) ? Number(r.itemId) : null;
}

export function buildExportItems(rows: readonly ExportMappingRow[], groups: readonly ExportGroupRow[], events: readonly ExportEventRow[]): ExportItem[] {
  const eventByKey = new Map<string, ExportEventRow>();
  for (const e of events) if (e.eventKey) eventByKey.set(e.eventKey, e);
  // カテゴリ key → イベント。同じカテゴリを複数イベントが指す場合は open > pre > closed、同順位なら id の大きい方
  const eventByGroup = new Map<string, ExportEventRow>();
  for (const e of events) {
    if (!e.itemGroupKey) continue;
    const cur = eventByGroup.get(e.itemGroupKey);
    const rank = (x: ExportEventRow) => (STATUS_RANK[x.status] ?? 0) * 1e9 + x.id;
    if (!cur || rank(e) > rank(cur)) eventByGroup.set(e.itemGroupKey, e);
  }
  const groupsByItem = new Map<number, ExportGroupRow[]>();
  for (const g of groups) {
    const list = groupsByItem.get(g.itemId) ?? [];
    list.push(g);
    groupsByItem.set(g.itemId, list);
  }
  // 同じ数値 id を持つ行が複数ある場合（旧シード行 "ouen_zou" 等が whowatch_id=10773 を持ち、日次同期の行 "10773" と重なる。
  // 2026-09-28 本番で 7 件）は 1 行にする。優先: item_id が数値そのもの（日次同期の行）→ last_fetched_at が新しい方
  const bestByKey = new Map<string, ExportMappingRow>();
  const prefer = (a: ExportMappingRow, b: ExportMappingRow): ExportMappingRow => {
    const an = /^\d+$/.test(a.itemId);
    const bn = /^\d+$/.test(b.itemId);
    if (an !== bn) return an ? a : b;
    const at = a.lastFetchedAt ? new Date(a.lastFetchedAt).getTime() : 0;
    const bt = b.lastFetchedAt ? new Date(b.lastFetchedAt).getTime() : 0;
    return bt > at ? b : a;
  };
  for (const r of rows) {
    const id = numericItemId(r);
    const key = id !== null ? String(id) : r.itemId;
    const cur = bestByKey.get(key);
    bestByKey.set(key, cur ? prefer(cur, r) : r);
  }
  const out: ExportItem[] = [];
  for (const r of bestByKey.values()) {
    const id = numericItemId(r);
    const itemId = id !== null ? String(id) : r.itemId;
    const gs = [...(id !== null ? (groupsByItem.get(id) ?? []) : [])].sort((a, b) => (a.displayOrder ?? 9999) - (b.displayOrder ?? 9999) || a.groupKey.localeCompare(b.groupKey));
    let event: ExportEventRow | null = null;
    for (const g of gs) {
      if (g.eventKey && eventByKey.has(g.eventKey)) {
        event = eventByKey.get(g.eventKey)!;
        break;
      }
    }
    if (!event) {
      for (const g of gs) {
        const e = eventByGroup.get(g.groupKey);
        if (e) {
          event = e;
          break;
        }
      }
    }
    const free = r.state === "FREE";
    out.push({
      item_id: itemId,
      item_name: r.itemName,
      price_jpy: free ? 0 : Math.max(0, r.priceJpy),
      purchasable: !free && r.productId !== "",
      event_id: event?.id ?? null,
      event_key: event?.eventKey ?? null,
      group_keys: gs.map((g) => g.groupKey),
      state: r.state,
      on_sale: r.state === "OPEN",
      last_fetched_at: r.lastFetchedAt ? new Date(r.lastFetchedAt).toISOString() : null,
    });
  }
  return out.sort((a, b) => Number(a.item_id) - Number(b.item_id) || a.item_id.localeCompare(b.item_id));
}
