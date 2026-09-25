import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildRankingType,
  clearEventApiCache,
  computeEventKind,
  endTimeFromEndedAt,
  flattenRankingChoices,
  getEventDetail,
  getEventLists,
  htmlToText,
  type RankingStruct,
} from "./events";

// 2026-09-20 実応答の縮約フィクスチャ（オータムグッズ）
const STRUCT_OPTIONS: RankingStruct = {
  name: "ふわっちオータムグッズコレクション",
  options: [
    {
      key: "1st",
      value: "前半",
      selectboxes: [
        { key: "overall", value: "前半総合", border: [{ rank: 5, color: "#fde6ab" }, { rank: 10 }] },
        {
          key: "moriageneko",
          value: "もりあげねこさんの食欲の秋",
          border: [{ rank: 1 }, { rank: 2 }, { rank: 3 }],
          tabs: [
            { key: "set", value: "食欲の秋セット", chips: [{ key: "free", value: "フリー" }, { key: "gold", value: "ゴールド" }] },
          ],
        },
      ],
    },
  ],
};

const STRUCT_TABS: RankingStruct = {
  tabs: [{ key: "gold", value: "ゴールド", chips: [{ key: "a", value: "A" }, { key: "b", value: "B" }] }],
};

describe("computeEventKind / endTimeFromEndedAt", () => {
  it("36h 未満はデイリー、それ以上は long、期間不明は null", () => {
    const day = 24 * 3600 * 1000;
    const t0 = Date.UTC(2026, 8, 21, 15, 0, 0); // 2026-09-22 00:00:00 JST
    expect(computeEventKind(t0, t0 + day - 1000)).toBe("daily");
    expect(computeEventKind(t0, t0 + 5 * day)).toBe("long");
    expect(computeEventKind(null, t0 + 5 * day)).toBeNull();
    expect(computeEventKind(0, t0)).toBeNull(); // started_at=0 は「無し」扱い
    expect(computeEventKind(t0 + 10, t0)).toBeNull();
  });

  it("ended_at(23:59:59 JST) + 1 秒 = 翌日 00:00:00 JST", () => {
    // 2026-09-22 23:59:59 JST = 2026-09-22T14:59:59Z
    const endedAt = Date.UTC(2026, 8, 22, 14, 59, 59);
    expect(endTimeFromEndedAt(endedAt).toISOString()).toBe("2026-09-22T15:00:00.000Z");
  });
});

describe("ranking type 構築", () => {
  it("prefix と parts を _ で連結する", () => {
    expect(buildRankingType("autumncollection", ["1st", "overall"])).toBe("autumncollection_1st_overall");
    expect(buildRankingType("psr", ["gold", "plus", "a"])).toBe("psr_gold_plus_a");
  });

  it("options 型: selectbox 末端と tabs→chips 末端を平坦化する", () => {
    const choices = flattenRankingChoices("autumncollection", STRUCT_OPTIONS);
    expect(choices.map((c) => c.rankingType)).toEqual([
      "autumncollection_1st_overall",
      "autumncollection_1st_moriageneko_set_free",
      "autumncollection_1st_moriageneko_set_gold",
    ]);
    expect(choices[0].label).toBe("前半 › 前半総合");
    expect(choices[0].border.map((b) => b.rank)).toEqual([5, 10]);
    // tab に border が無ければ selectbox の border を引き継ぐ
    expect(choices[1].border.map((b) => b.rank)).toEqual([1, 2, 3]);
  });

  it("tabs 型: prefix_tab_chip", () => {
    const choices = flattenRankingChoices("psr", STRUCT_TABS);
    expect(choices.map((c) => c.rankingType)).toEqual(["psr_gold_a", "psr_gold_b"]);
  });

  it("空構造は空配列", () => {
    expect(flattenRankingChoices("x", null)).toEqual([]);
    expect(flattenRankingChoices("x", {})).toEqual([]);
  });
});

describe("htmlToText", () => {
  it("style/script を除去し、br と段落を改行に、実体参照を復元する", () => {
    const html =
      "<style>h2{color:red}</style><h2>期間</h2><p>0:00 &#65374; 24:00<br>1%&nbsp;=&nbsp;20倍</p><table><tr><td>レギュラー</td><td>250pt</td></tr></table>";
    const text = htmlToText(html);
    expect(text).not.toContain("color:red");
    expect(text).toContain("期間\n0:00 ～ 24:00\n1% = 20倍");
    expect(text).toContain("レギュラー 250pt");
  });
});

describe("API クライアント", () => {
  let originalFetch: typeof global.fetch;
  beforeEach(() => {
    originalFetch = global.fetch;
    clearEventApiCache();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("event_lists を正規化し、Origin/Referer/UA を付けて叩く", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.whowatch.tv/event_lists");
      const h = init?.headers as Record<string, string>;
      expect(h.origin).toBe("https://whowatch.tv");
      expect(h.referer).toBe("https://whowatch.tv/");
      expect(h["User-Agent"]).toContain("TagDeck");
      return new Response(
        JSON.stringify({
          pre: [{ id: 1522, event_key: "2026_09_wolfcoming", banner: "b.png", started_at: 1790348400000, ended_at: 1790780399000, text: "参加人数: 737人", badge: { text: "エントリー受付中" } }],
          open: [{ id: 1512, event_key: "2026_09_gingiragin" }],
          closed: [],
        }),
        { status: 200 },
      );
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const lists = await getEventLists();
    expect(lists.pre[0]).toMatchObject({ id: 1522, eventKey: "2026_09_wolfcoming", startedAt: 1790348400000, participants: "参加人数: 737人", badgeText: "エントリー受付中" });
    expect(lists.open[0]).toMatchObject({ id: 1512, startedAt: null, endedAt: null });

    // 10 分キャッシュ: 2 回目は fetch されない
    await getEventLists();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("event_lists/{key} から RANKING prefix と NOTIFICATION id を取り出す", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          event_key: "2026_09_autumncollection",
          name: "オータムグッズ",
          short_name: "オータムグッズ",
          tabs: [
            { title: "概要", type: "NOTIFICATION", detail: "2329967" },
            { title: "特典", type: "NOTIFICATION", detail: "2329968" },
            { title: "ランキング", type: "RANKING", detail: "autumncollection" },
            { title: "アイテム", type: "ITEM", detail: "autumncollection" },
          ],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const d = await getEventDetail("2026_09_autumncollection");
    expect(d.rankingPrefix).toBe("autumncollection");
    expect(d.notificationIds).toEqual(["2329967", "2329968"]);
    expect(d.name).toBe("オータムグッズ");
  });
});
