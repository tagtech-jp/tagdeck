import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildWhowatchLiveUrl,
  fetchLatestLive,
  pollWhowatchStreamerState,
  resolveWhowatchDeviceId,
} from "./whowatch";

const API_URL = "https://api.whowatch.tv/lives2?category_id=152";

describe("whowatch live polling client", () => {
  let originalFetch: typeof global.fetch;
  let originalDeviceId: string | undefined;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalDeviceId = process.env.WHOWATCH_DEVICE_ID;
    process.env.WHOWATCH_DEVICE_ID = "tagdeck-test-device-id";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalDeviceId === undefined) {
      delete process.env.WHOWATCH_DEVICE_ID;
    } else {
      process.env.WHOWATCH_DEVICE_ID = originalDeviceId;
    }
  });

  it("sends whowatch headers required by the public API", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    });
    global.fetch = mockFetch;

    await fetchLatestLive("123");

    expect(mockFetch).toHaveBeenCalledWith(
      API_URL,
      expect.objectContaining({
        headers: expect.objectContaining({
          "User-Agent": "TagDeck/0.1 (+https://tagdeck.jp)",
          "x-whowatch-device-id": "tagdeck-test-device-id",
          origin: "https://whowatch.tv",
          referer: "https://whowatch.tv/",
        }),
      }),
    );
  });

  it("matches a live by whowatch account name", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 73000000,
          title: "live",
          view_count: 10,
          item_count: 20,
          user: { id: 1, account_name: "@zenitu1217", user_path: "t:zenitu1217" },
        },
      ],
    });
    global.fetch = mockFetch;

    const live = await fetchLatestLive("@zenitu1217");

    expect(live?.id).toBe(73000000);
  });

  it("auto-generates a stable device id when WHOWATCH_DEVICE_ID is missing", () => {
    delete process.env.WHOWATCH_DEVICE_ID;

    expect(resolveWhowatchDeviceId("123")).toBe(resolveWhowatchDeviceId("123"));
    expect(resolveWhowatchDeviceId("123")).toMatch(/^tagdeck-auto-/);
  });

  it("builds a live URL from a live id", () => {
    expect(buildWhowatchLiveUrl("abc123")).toBe("https://whowatch.tv/abc123");
    expect(buildWhowatchLiveUrl(null)).toBeNull();
  });
});

// pollWhowatchStreamerState の伝搬検証:
// 「実APIレスポンス形（.live 配下） → poll レスポンス → UI 表示値」の経路を、
// read-only実機調査（2026-07-19・2026-07-24の2回実施）で確認した実レスポンス形そのままでテストする。
//
// 2026-07-24の再検証で comment_count / item_count は次の理由によりUI非表示に変更した:
//   - comment_count: アクティブなチャットが多数あるライブ（view_count 2000超）でも 0 のまま
//     25秒間変化せず、社長の公式画面実測値（124件）とも大きく乖離。信頼できない。
//   - item_count: 社長の公式画面実測値（109pt）と一致せず、別の配信では view_count と
//     偶然同値になるケースもあり、ポイント/個数いずれの確証も得られなかった。
// 代わりに total_view_count（累計視聴数・時系列で単調増加を確認済み）を表示対象に追加した。
describe("pollWhowatchStreamerState", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // 実機調査で確認済みの /lives2 一覧エントリ形（抜粋）
  const REAL_LIVES2_ENTRY = {
    id: 74657143,
    title: "配信タイトル",
    user: {
      id: 60916,
      name: "配信者",
      user_path: "t:example_user",
      account_name: "@example_user",
    },
    view_count: 2153,
    comment_count: 0,
  };

  // 実機調査（2026-07-24・view_count 2000超のアクティブなライブ）で確認済みの
  // /lives/{id} 詳細（.live 配下・抜粋）。comment_countが0のまま25秒変化しなかった実例。
  const REAL_LIVE_DETAIL = {
    id: 74657143,
    live_type: "MOVIE",
    title: "配信タイトル",
    live_status: "PUBLISHING",
    user: {
      id: 60916,
      name: "配信者",
      user_path: "t:example_user",
      account_name: "@example_user",
    },
    total_view_count: 3190,
    comment_count: 0,
    item_count: 855,
    nice_info: { status: 1, total_count: 55 },
    view_count: 2153,
  };

  it("propagates total_view_count / nice_info.total_count through to the streamer state", async () => {
    const mockFetch = vi.fn(async (url: string) => {
      if (url.startsWith("https://api.whowatch.tv/lives2")) {
        return { ok: true, json: async () => [REAL_LIVES2_ENTRY] };
      }
      if (url === "https://api.whowatch.tv/lives/74657143") {
        return { ok: true, json: async () => ({ live: REAL_LIVE_DETAIL }) };
      }
      return { ok: false, json: async () => ({}) };
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const state = await pollWhowatchStreamerState("60916");

    expect(state.isLive).toBe(true);
    expect(state.viewerCount).toBe(2153);
    expect(state.totalViewCount).toBe(3190);
    expect(state.niceCount).toBe(55);
    // comment_count/item_countはstateに含まれない（信頼性未確認のため意図的に除外）
    expect(state).not.toHaveProperty("commentCount");
    expect(state).not.toHaveProperty("itemCount");
  });

  it("does not fall back to item_count when total_point is absent (2026-07-24 修正)", async () => {
    // REAL_LIVE_DETAIL は total_point 欠落・item_count:855 のみ存在する実測ケース。
    // 旧resolveWhowatchPointCount(total_point ?? item_count)だとcurrentPointsが855に汚染されていた。
    const mockFetch = vi.fn(async (url: string) => {
      if (url.startsWith("https://api.whowatch.tv/lives2")) {
        return { ok: true, json: async () => [REAL_LIVES2_ENTRY] };
      }
      if (url === "https://api.whowatch.tv/lives/74657143") {
        return { ok: true, json: async () => ({ live: REAL_LIVE_DETAIL }) };
      }
      return { ok: false, json: async () => ({}) };
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const state = await pollWhowatchStreamerState("60916");

    expect(state.currentPoints).toBe(0);
  });

  it("returns zeroed counts when the streamer is not live", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    global.fetch = mockFetch as unknown as typeof fetch;

    const state = await pollWhowatchStreamerState("no-such-user");

    expect(state.isLive).toBe(false);
    expect(state.viewerCount).toBe(0);
    expect(state.totalViewCount).toBe(0);
    expect(state.niceCount).toBe(0);
  });

  it("defaults totalViewCount/niceCount to 0 when the real API omits those fields entirely", async () => {
    // 一部配信・カテゴリでフィールド自体が欠落するケースを想定した防御的デフォルト値の検証
    const mockFetch = vi.fn(async (url: string) => {
      if (url.startsWith("https://api.whowatch.tv/lives2")) {
        return { ok: true, json: async () => [REAL_LIVES2_ENTRY] };
      }
      if (url === "https://api.whowatch.tv/lives/74657143") {
        return {
          ok: true,
          json: async () => ({
            live: { id: 74657143, title: "配信タイトル", view_count: 2153 },
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const state = await pollWhowatchStreamerState("60916");

    expect(state.isLive).toBe(true);
    expect(state.totalViewCount).toBe(0);
    expect(state.niceCount).toBe(0);
  });
});
