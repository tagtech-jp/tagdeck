import { describe, expect, it } from "vitest";
import { extractComments, isBacklogComment, looksLikeComment, parseWsMessage, WS_RECONNECT_MAX_MS, wsReconnectDelay, wsUrlCandidates } from "./ws-feed";

const GIFT = { id: 123, comment_type: "BY_PLAYITEM", play_item_pattern_id: 10365, item_count: 1, posted_at: 1_800_000_000_000 };
const TEXT = { id: "124", comment_type: "BY_USER", message: "こんにちは" };

describe("wsUrlCandidates", () => {
  it("URL をそのまま、次に jwt をクエリで付けた候補を返す", () => {
    expect(wsUrlCandidates("wss://c.example/lives/1", "tok")).toEqual(["wss://c.example/lives/1", "wss://c.example/lives/1?jwt=tok"]);
  });
  it("jwt が URL に含まれている・無い場合は 1 候補", () => {
    expect(wsUrlCandidates("wss://c.example/l?jwt=tok", "tok")).toEqual(["wss://c.example/l?jwt=tok"]);
    expect(wsUrlCandidates("wss://c.example/l", null)).toEqual(["wss://c.example/l"]);
  });
  it("ws:// 以外や空は候補なし（http の URL に jwt を付けて送らない）", () => {
    expect(wsUrlCandidates("https://c.example/l", "tok")).toEqual([]);
    expect(wsUrlCandidates(null, "tok")).toEqual([]);
    expect(wsUrlCandidates("", "tok")).toEqual([]);
  });
});

describe("wsReconnectDelay", () => {
  it("1→2→4 秒と増え、30 秒で頭打ち", () => {
    expect(wsReconnectDelay(0)).toBe(1_000);
    expect(wsReconnectDelay(1)).toBe(2_000);
    expect(wsReconnectDelay(2)).toBe(4_000);
    expect(wsReconnectDelay(9)).toBe(WS_RECONNECT_MAX_MS);
    expect(wsReconnectDelay(100)).toBe(WS_RECONNECT_MAX_MS);
  });
});

describe("parseWsMessage", () => {
  it("JSON 文字列はオブジェクトに、壊れたもの・文字列以外は null", () => {
    expect(parseWsMessage('{"a":1}')).toEqual({ a: 1 });
    expect(parseWsMessage("not json")).toBeNull();
    expect(parseWsMessage("")).toBeNull();
    expect(parseWsMessage(new ArrayBuffer(2))).toBeNull();
  });
});

describe("extractComments（形式未確定のため入れ子まで探す）", () => {
  it("トップレベルがコメントならそれを返す", () => {
    expect(extractComments(GIFT)).toEqual([GIFT]);
    expect(looksLikeComment(GIFT)).toBe(true);
  });
  it("配列・入れ子（comments / data.comment）から出現順に拾う", () => {
    expect(extractComments([GIFT, TEXT])).toEqual([GIFT, TEXT]);
    expect(extractComments({ comments: [TEXT, GIFT] })).toEqual([TEXT, GIFT]);
    expect(extractComments({ type: "comment", data: { comment: GIFT } })).toEqual([GIFT]);
  });
  it("コメントの中の user オブジェクトまで潜らない（コメント 1 件で止まる）", () => {
    const withUser = { ...GIFT, user: { id: 1, name: "x", comment_type: "nested?" } };
    expect(extractComments(withUser)).toEqual([withUser]);
  });
  it("コメントらしくないもの・深すぎる入れ子は拾わない", () => {
    expect(extractComments({ type: "ping" })).toEqual([]);
    expect(extractComments("BY_PLAYITEM")).toEqual([]);
    expect(extractComments({ a: { b: { c: { d: { e: GIFT } } } } })).toEqual([]);
    expect(extractComments(null)).toEqual([]);
  });
});

describe("isBacklogComment", () => {
  const CONNECTED = 1_800_000_100_000;
  it("接続の 10 秒以上前に投稿されたものは過去分", () => {
    expect(isBacklogComment(CONNECTED - 10_001, CONNECTED)).toBe(true);
    expect(isBacklogComment(CONNECTED - 9_000, CONNECTED)).toBe(false);
    expect(isBacklogComment(CONNECTED + 500, CONNECTED)).toBe(false);
  });
  it("posted_at が無ければ鳴らす側に倒す", () => {
    expect(isBacklogComment(undefined, CONNECTED)).toBe(false);
  });
});
