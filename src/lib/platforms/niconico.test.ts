import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchNicoLive } from "./niconico";

describe("niconico live polling client", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("parses current program data from watch/user embedded data", async () => {
    const props = JSON.stringify({
      program: {
        nicoliveProgramId: "lv350614454",
        title: "current live",
        status: "ON_AIR",
        beginTime: 1779786514,
        statistics: { watchCount: 32, commentCount: 19 },
      },
      socialGroup: { id: "co0" },
    })
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;");

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `<script id="embedded-data" data-props="${props}"></script>`,
    });

    const program = await fetchNicoLive("371385");

    expect(program).toEqual({
      programId: "lv350614454",
      communityId: "co0",
      title: "current live",
      isLive: true,
      viewerCount: 32,
      commentCount: 19,
      startedAt: new Date(1779786514 * 1000),
    });
  });
});
