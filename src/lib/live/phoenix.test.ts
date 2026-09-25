import { describe, expect, it } from "vitest";
import { commentsFromFrame, createRefCounter, decodeFrame, heartbeatFrame, joinFrame, leaveFrame, phoenixSocketUrl, replyStatus, topicCandidates } from "./phoenix";

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
