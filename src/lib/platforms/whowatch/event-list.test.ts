// @ts-nocheck — vitest は devDependency として別途 `pnpm add -D vitest` が必要
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWhowatchEvents, fetchWhowatchEventList, epochMsToDate } from "./event-list";

const EXPECTED_UA = "TagDeck/0.1 (+https://tagdeck.jp)";
const API_URL = "https://api.whowatch.tv/event_lists";
const HTML_URL = "https://whowatch.tv/events";

function makeFetchMock(responses: Array<{ url: string; ok: boolean; body: unknown }>) {
  return vi.fn(async (url: string) => {
    const match = responses.find((r) => r.url === url);
    if (!match) return { ok: false, json: async () => ({}), text: async () => "" };
    return {
      ok: match.ok,
      json: async () => match.body,
      text: async () => (typeof match.body === "string" ? match.body : ""),
    };
  });
}

const apiBody = {
  open: [
    { id: 101, event_key: "monthly_2026_05", ended_at: "2026-05-31T23:59:59Z", started_at: "2026-05-01T00:00:00Z" },
  ],
  pre: [],
  closed: [],
};
const embeddedHtml = `<html><script id="embedded-data" data-props="{&quot;eventList&quot;:[{&quot;id&quot;:&quot;ev2&quot;,&quot;name&quot;:&quot;ウィークリー&quot;,&quot;start_at&quot;:&quot;2026-05-01T00:00:00Z&quot;,&quot;end_at&quot;:&quot;2026-05-07T23:59:59Z&quot;}]}"></script></html>`;

describe("fetchWhowatchEvents", () => {
  let originalFetch: typeof global.fetch;
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalEnv = process.env.WHOWATCH_DEVICE_ID;
    process.env.WHOWATCH_DEVICE_ID = "tagdeck-test-device-id";
  });
  afterEach(() => {
    global.fetch = originalFetch;
    if (originalEnv === undefined) delete process.env.WHOWATCH_DEVICE_ID;
    else process.env.WHOWATCH_DEVICE_ID = originalEnv;
  });

  // (1) 第一候補 API 成功
  it("returns events from event_lists API when first candidate succeeds", async () => {
    global.fetch = makeFetchMock([{ url: API_URL, ok: true, body: apiBody }]);
    const result = await fetchWhowatchEvents();
    expect(result.source).toBe("api");
    expect(result.events).toHaveLength(1);
    expect(result.events[0].eventId).toBe("101");
  });

  // (2) 第一候補失敗 → 第二候補 embedded JSON 成功
  it("falls back to embedded HTML when API returns non-ok", async () => {
    global.fetch = makeFetchMock([
      { url: API_URL, ok: false, body: {} },
      { url: HTML_URL, ok: true, body: embeddedHtml },
    ]);
    const result = await fetchWhowatchEvents();
    expect(result.source).toBe("embedded");
    expect(result.events).toHaveLength(1);
  });

  // (3) 全失敗 → manual フォールバック
  it("returns manual source when both candidates fail", async () => {
    global.fetch = makeFetchMock([
      { url: API_URL, ok: false, body: {} },
      { url: HTML_URL, ok: false, body: "" },
    ]);
    const result = await fetchWhowatchEvents();
    expect(result.source).toBe("manual");
    expect(result.events).toHaveLength(0);
  });

  // (4) fetch が例外をスロー (タイムアウト相当) → manual
  it("returns manual when fetch throws (e.g. timeout)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("AbortError"));
    const result = await fetchWhowatchEvents();
    expect(result.source).toBe("manual");
    expect(result.events).toHaveLength(0);
  });

  // (5) User-Agent ヘッダが TagDeck/0.1 (+https://tagdeck.jp) であることを確認
  it("sends correct User-Agent header", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}), text: async () => "" });
    global.fetch = mockFetch;
    await fetchWhowatchEvents();
    const firstCall = mockFetch.mock.calls[0];
    expect(firstCall[1]?.headers?.["User-Agent"]).toBe(EXPECTED_UA);
  });

  // (6) device-id なし時は API をスキップして embedded / manual にフォールバック
  it("skips API call when WHOWATCH_DEVICE_ID is not set", async () => {
    delete process.env.WHOWATCH_DEVICE_ID;
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}), text: async () => "" });
    global.fetch = mockFetch;
    const result = await fetchWhowatchEvents();
    expect(result.source).not.toBe("api");
    const calledUrls = mockFetch.mock.calls.map((c) => c[0] as string);
    expect(calledUrls).not.toContain(API_URL);
  });

  // (7) ホワイトリスト外 URL への fetch が発生しないこと
  it("never fetches URLs outside the allowed list", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}), text: async () => "" });
    global.fetch = mockFetch;
    await fetchWhowatchEvents();
    const calledUrls = mockFetch.mock.calls.map((c) => c[0] as string);
    const allowedPrefixes = ["https://api.whowatch.tv/event_lists", "https://whowatch.tv/events"];
    for (const url of calledUrls) {
      expect(allowedPrefixes.some((allowed) => url === allowed)).toBe(true);
    }
  });
});

describe("epochMsToDate", () => {
  it("converts epoch ms to Date", () => {
    const d = epochMsToDate(1780531199000);
    expect(d).toBeInstanceOf(Date);
    expect(d?.getTime()).toBe(1780531199000);
  });

  it("returns null for 0 / null / undefined / empty / invalid", () => {
    expect(epochMsToDate(0)).toBeNull();
    expect(epochMsToDate(null)).toBeNull();
    expect(epochMsToDate(undefined)).toBeNull();
    expect(epochMsToDate("")).toBeNull();
    expect(epochMsToDate("abc")).toBeNull();
    expect(epochMsToDate(-1)).toBeNull();
  });

  it("accepts numeric string", () => {
    expect(epochMsToDate("1780531199000")?.getTime()).toBe(1780531199000);
  });
});

describe("fetchWhowatchEventList (DB 同期用)", () => {
  let originalFetch: typeof global.fetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  const rawBody = {
    pre: [
      {
        id: 200,
        event_key: "upcoming_event",
        banner: "https://cdn.example/b.png",
        badge: { text: "エントリー受付中", color: "#FF0000", animation: false },
        text: "参加人数: 0人",
        started_at: 1780000000000,
        ended_at: 1782000000000,
      },
    ],
    open: [
      {
        id: 101,
        event_key: "monthly_2026_05",
        started_at: 1777000000000,
        ended_at: 1780531199000,
      },
    ],
    closed: [],
  };

  it("maps pre/open/closed buckets with epoch ms → Date", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => rawBody });
    const rows = await fetchWhowatchEventList("dev-id");
    expect(rows).toHaveLength(2);
    const open = rows.find((r) => r.id === 101)!;
    expect(open.status).toBe("open");
    expect(open.eventKey).toBe("monthly_2026_05");
    expect(open.endedAt).toBeInstanceOf(Date);
    expect(open.endedAt?.getTime()).toBe(1780531199000);
    expect(open.startedAt?.getTime()).toBe(1777000000000);
    const pre = rows.find((r) => r.id === 200)!;
    expect(pre.status).toBe("pre");
    expect(pre.badgeText).toBe("エントリー受付中");
    expect(pre.bannerUrl).toBe("https://cdn.example/b.png");
    expect(pre.participants).toBe("参加人数: 0人");
  });

  it("sends UA + device-id headers to the event_lists API only", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => rawBody });
    global.fetch = mockFetch;
    await fetchWhowatchEventList("dev-id");
    expect(mockFetch).toHaveBeenCalledWith(
      API_URL,
      expect.objectContaining({
        headers: expect.objectContaining({
          "User-Agent": EXPECTED_UA,
          "x-whowatch-device-id": "dev-id",
        }),
      }),
    );
    for (const c of mockFetch.mock.calls) expect(c[0]).toBe(API_URL);
  });

  it("returns empty array when device-id is empty (no fetch)", async () => {
    const mockFetch = vi.fn();
    global.fetch = mockFetch;
    const rows = await fetchWhowatchEventList("");
    expect(rows).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns empty array when API is not ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    expect(await fetchWhowatchEventList("dev-id")).toEqual([]);
  });

  it("returns empty array when fetch throws", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network"));
    expect(await fetchWhowatchEventList("dev-id")).toEqual([]);
  });
});
