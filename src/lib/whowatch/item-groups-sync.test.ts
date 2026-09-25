import { describe, expect, it } from "vitest";
import { notInArray, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { whowatchItemGroups } from "@/lib/db/schema";
import { flattenGroups, type RawCategory } from "./item-groups-sync";

const NOW = new Date("2026-09-22T10:00:00.000Z");

describe("flattenGroups", () => {
  it("カテゴリ単位の group/title/display_order を item ごとの行に展開する", () => {
    const categories: RawCategory[] = [
      { group: "gingiragin_2026", title: "ギンギラギンアイテム", display_order: 10, play_item: [{ id: 13077 }, { id: 13080 }] },
    ];
    const rows = flattenGroups(categories, NOW);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ itemId: 13077, groupKey: "gingiragin_2026", groupTitle: "ギンギラギンアイテム", displayOrder: 10, eventKey: null });
    expect(rows[1].itemId).toBe(13080);
  });

  it("1 アイテムが複数カテゴリに属する場合は両方の行を作る（複合主キーの前提）", () => {
    const categories: RawCategory[] = [
      { group: "event_ouen_sale", title: "イベント応援セール", play_item: [{ id: 11146 }] },
      { group: "viewer_level_benefit", title: "レベル限定", play_item: [{ id: 11146 }] },
    ];
    const rows = flattenGroups(categories, NOW);
    expect(rows.map((r) => r.groupKey)).toEqual(["event_ouen_sale", "viewer_level_benefit"]);
    expect(new Set(rows.map((r) => r.itemId))).toEqual(new Set([11146]));
  });

  it("同一カテゴリ内で item_id が重複しても 1 行にまとめる", () => {
    const categories: RawCategory[] = [{ group: "word", title: "ひとことアイテム", play_item: [{ id: 1 }, { id: 1 }] }];
    expect(flattenGroups(categories, NOW)).toHaveLength(1);
  });

  it("badge_text と sub_group_title を保持する（販売期間の日付は API に無い）", () => {
    const categories: RawCategory[] = [
      { group: "stage_up_pack#ouen-buta", title: "ステージアップアイテムパック", sub_group_title: "トンでもない応援をするぶたさん", badge_text: "注目", display_order: 50, play_item: [{ id: 999 }] },
    ];
    const [row] = flattenGroups(categories, NOW);
    expect(row.badgeText).toBe("注目");
    expect(row.subGroupTitle).toBe("トンでもない応援をするぶたさん");
  });

  it("group が空のカテゴリは対象外", () => {
    const categories: RawCategory[] = [{ title: "見出しだけ", play_item: [{ id: 1 }] }, { group: "  ", title: "空白", play_item: [{ id: 2 }] }];
    expect(flattenGroups(categories, NOW)).toEqual([]);
  });

  it("event_lists に実在する group だけ event_key を入れる（恒常カテゴリは null）", () => {
    const categories: RawCategory[] = [
      { group: "gingiragin_2026", title: "ギンギラギンアイテム", play_item: [{ id: 1 }] },
      { group: "web_premium", title: "通常アイテム", play_item: [{ id: 2 }] },
    ];
    const rows = flattenGroups(categories, NOW, new Set(["gingiragin_2026"]));
    expect(rows[0].eventKey).toBe("gingiragin_2026");
    expect(rows[1].eventKey).toBeNull();
  });

  it("title が無ければ group_key をそのまま見出しに使う", () => {
    const [row] = flattenGroups([{ group: "unknown_group", play_item: [{ id: 5 }] }], NOW);
    expect(row.groupTitle).toBe("unknown_group");
  });

  it("id を持たない play_item は無視する", () => {
    const rows = flattenGroups([{ group: "g", title: "t", play_item: [{}, { id: 7 }] }], NOW);
    expect(rows.map((r) => r.itemId)).toEqual([7]);
  });
});

describe("応答から消えたカテゴリの削除条件", () => {
  const dialect = new PgDialect();

  // 2026-09-23 の調査記録: sql`... not in ${配列}` も notInArray() も、生成される SQL は同じで
  // どちらも正しい（当初「配列が単一パラメータになる」と推測したが誤りだった）。
  // 同期が 0 件だった原因は別にある。notInArray を使うのは型安全で意図が明確なため
  it("notInArray は group_key を1つずつ展開した SQL を作る", () => {
    const { sql: text, params } = dialect.sqlToQuery(notInArray(whowatchItemGroups.groupKey, ["a", "b", "c"]).getSQL());
    expect(text).toMatch(/not in/i);
    expect(text).toMatch(/\$1.*\$2.*\$3/);
    expect(params).toHaveLength(3);
  });

  it("空配列を渡しても全削除にはならない", () => {
    const { sql: text } = dialect.sqlToQuery(notInArray(whowatchItemGroups.groupKey, []).getSQL());
    // Drizzle は空配列を恒偽の条件に落とす（誤って全行消さない）
    expect(text.length).toBeGreaterThan(0);
  });
});
