import { describe, expect, it } from "vitest";
import { commentsFromFrame, createRefCounter, decodeFrame, heartbeatFrame, joinCandidates, joinFrame, leaveFrame, phoenixSocketUrl, replyStatus, topicCandidates } from "./phoenix";

const GIFT = { id: 123, comment_type: "BY_PLAYITEM", play_item_pattern_id: 10365, item_count: 1 };

describe("phoenixSocketUrl", () => {
  it("/socket → /socket/websocket?vsn=2.0.0&token=jwt（実測どおり）", () => {
    expect(phoenixSocketUrl("wss://ws.whowatch.tv/socket", "tok")).toBe("wss://ws.whowatch.tv/socket/websocket?vsn=2.0.0&token=tok");
  });
  it("jwt が無ければ token を付けない。既に /websocket ならそのまま。ws(s) 以外は null", () => {
    expect(phoenixSocketUrl("wss://h/socket", null)).toBe("wss://h/socket/websocket?vsn=2.0.0");
    expect(phoenixSocketUrl("wss://h/socket/websocket", null)).toBe("wss://h/socket/websocket?vsn=2.0.0");
    expect(phoenixSocketUrl("https://h/socket", "t")).toBeNull();
    expect(phoenixSocketUrl(null, "t")).toBeNull();
  });
});

describe("encode / decode（V2: [join_ref, ref, topic, event, payload]）", () => {
  it("join / heartbeat / leave を V2 配列で組み立てる", () => {
    expect(JSON.parse(joinFrame("live:1", "1"))).toEqual(["1", "1", "live:1", "phx_join", {}]);
    expect(JSON.parse(heartbeatFrame("2"))).toEqual([null, "2", "phoenix", "heartbeat", {}]);
    expect(JSON.parse(leaveFrame("live:1", "1", "3"))).toEqual(["1", "3", "live:1", "phx_leave", {}]);
  });
  it("受信フレームを読み、形が違えば null", () => {
    expect(decodeFrame('["1","1","live:1","phx_reply",{"status":"ok","response":{}}]')).toEqual({ joinRef: "1", ref: "1", topic: "live:1", event: "phx_reply", payload: { status: "ok", response: {} } });
    expect(decodeFrame('[null,null,"live:1","comment",{"id":1}]')?.joinRef).toBeNull();
    expect(decodeFrame('{"not":"array"}')).toBeNull();
    expect(decodeFrame('["a","b","c"]')).toBeNull();
    expect(decodeFrame(new ArrayBuffer(1))).toBeNull();
  });
});

describe("replyStatus / commentsFromFrame", () => {
  it("phx_reply の ok / error を判定し、それ以外は null", () => {
    expect(replyStatus(decodeFrame('["1","1","live:1","phx_reply",{"status":"ok"}]')!)).toBe("ok");
    expect(replyStatus(decodeFrame('["1","1","live:1","phx_reply",{"status":"error","response":{"reason":"unmatched topic"}}]')!)).toBe("error");
    expect(replyStatus(decodeFrame('[null,null,"live:1","comment",{}]')!)).toBeNull();
  });
  it("イベントの payload からギフトコメントを拾う。制御フレームからは拾わない", () => {
    expect(commentsFromFrame(decodeFrame(JSON.stringify([null, null, "live:1", "new_comment", { comment: GIFT }]))!)).toEqual([GIFT]);
    expect(commentsFromFrame(decodeFrame(JSON.stringify(["1", "1", "live:1", "phx_reply", { status: "ok", response: { comments: [GIFT] } }]))!)).toEqual([]);
    expect(commentsFromFrame(decodeFrame(JSON.stringify([null, "2", "phoenix", "phx_reply", { status: "ok" }]))!)).toEqual([]);
  });
});

describe("topicCandidates / createRefCounter", () => {
  it("live:ID を先頭に候補を返し、ref は 1 から増える", () => {
    expect(topicCandidates("76347155")[0]).toBe("live:76347155");
    const next = createRefCounter();
    expect([next(), next(), next()]).toEqual(["1", "2", "3"]);
  });
});

describe("joinCandidates（実測: 公式サイトは room:<配信ID> に {\"p\": jwt} で参加）", () => {
  it("room:<id> {p: jwt} を先頭に、その後に従来の候補", () => {
    const c = joinCandidates("76347155", "SECRETJWT");
    expect(c[0]).toEqual({ topic: "room:76347155", payload: { p: "SECRETJWT" }, label: "room:76347155{p}" });
    expect(c[1].payload).toEqual({ p: "SECRETJWT", live_id: 76347155 });
    expect(c.filter((x) => x.topic === "live:lobby").length).toBe(8);
    expect(c.filter((x) => x.topic === "room:76347155").length).toBe(2);
    expect(c.find((x) => x.topic === "live:76347155")?.payload).toEqual({ token: "SECRETJWT" });
    // 表示用ラベルに jwt の値が混ざらない
    expect(c.every((x) => !x.label.includes("SECRETJWT"))).toBe(true);
  });
  it("jwt が無ければ jwt 系のキーを入れない", () => {
    const c = joinCandidates("1", null);
    expect(c[0]).toEqual({ topic: "room:1", payload: {}, label: "room:1{}" });
    expect(c[1].payload).toEqual({});
  });
});

describe("実キャプチャの WS フレーム（2026-09-25 room:76348066）", () => {
  // shout イベントの payload.comment にコメント本体（comment_type / id / play_item_pattern_id を持つ）
  const giftFrame = (patternId: number, count: number) =>
    JSON.stringify(["2", null, "room:76348066", "shout", {
      topic: "room:76348066", event: "shout",
      comment: {
        user: { user_path: "w:匿名盛り上げ係長", name: "匿名盛り上げ係長", id: 1523 },
        posted_at: 1790323435000, play_item_pattern_id: patternId, item_count: count,
        message: "どんぐり帽子をプレゼントしました", live_id: 76348066,
        id: 6432702623, comment_type: "BY_PLAYITEM", anonymized: true,
      },
    }]);
  const battleFrame = JSON.stringify(["2", null, "room:76348066", "battle", { topic: "room:76348066", event: "battle", collaboration_battle_point: { owner_point: 146, live_id: 76348066 } }]);
  const systemFrame = JSON.stringify(["2", null, "room:76348066", "shout", { topic: "room:76348066", event: "shout", comment: { user: { id: 1004 }, message: "コラボバトル終了", id: 6432703924, comment_type: "BY_SYSTEM" } }]);

  it("shout のギフト（BY_PLAYITEM）を payload.comment から抽出する", () => {
    const gifts = commentsFromFrame(decodeFrame(giftFrame(10587, 1))!).filter((c) => c.comment_type === "BY_PLAYITEM");
    expect(gifts).toHaveLength(1);
    expect(gifts[0].play_item_pattern_id).toBe(10587);
    expect(gifts[0].item_count).toBe(1);
    expect(gifts[0].id).toBe(6432702623);
  });
  it("battle イベントとシステムコメント（BY_SYSTEM）はギフトとして拾わない", () => {
    expect(commentsFromFrame(decodeFrame(battleFrame)!).filter((c) => c.comment_type === "BY_PLAYITEM")).toHaveLength(0);
    expect(commentsFromFrame(decodeFrame(systemFrame)!).filter((c) => c.comment_type === "BY_PLAYITEM")).toHaveLength(0);
  });
});
