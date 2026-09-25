import { describe, it, expect } from "vitest";
import {
  normalizeEventKeySlug,
  matchEventTemplate,
  DEFAULT_EVENT_TEMPLATE,
} from "./event-templates";

describe("normalizeEventKeySlug", () => {
  it("strips a leading YYYY_MM_ date prefix", () => {
    expect(normalizeEventKeySlug("2026_07_whowatchgrandprix")).toBe("whowatchgrandprix");
    expect(normalizeEventKeySlug("2026_07_weekend_4")).toBe("weekend_4");
  });

  it("returns the key unchanged when there is no date prefix", () => {
    expect(normalizeEventKeySlug("whowatch_dojo")).toBe("whowatch_dojo");
    expect(normalizeEventKeySlug("nice_one_ranking")).toBe("nice_one_ranking");
  });
});

describe("matchEventTemplate", () => {
  // 2026-07-24 event_lists 実データ(規約適合・単発取得)で確認済みの実キー
  const REAL_KEYS: Array<[string, string]> = [
    ["2026_07_whowatchgrandprix", "wgp"],
    ["2026_07_weekend_4", "weekend"],
    ["2026_07_stepup_2", "stepup"],
    ["2026_07_rookie_2", "rookie"],
    ["2026_07_vstar202607", "vstar"],
    ["2026_07_wwboss_3", "wwboss"],
    ["2026_07_gold_digger_1", "gold_digger"],
    ["2026_07_calendar2027", "calendar"],
    ["2026_07_samba_carnival", "samba"],
    ["2026_07_morinekobread", "morineko"],
    ["2026_07_legendteamers_final_battle", "team_battle"],
    ["2026_07_pubsup", "pubsup"],
    ["whowatch_dojo", "dojo"],
    ["nice_one_ranking", "nice_ranking"],
  ];

  it.each(REAL_KEYS)("matches real event_key %s to typeKey %s", (eventKey, typeKey) => {
    expect(matchEventTemplate(eventKey).typeKey).toBe(typeKey);
  });

  it("falls back to the default template for unclassified event_key", () => {
    expect(matchEventTemplate("2026_07_totally_unknown_event").typeKey).toBe("default");
    expect(matchEventTemplate("").typeKey).toBe("default");
  });

  it("every non-default template is unconfirmed by the CEO (ceoConfirmedAt is null)", () => {
    // R1: 初期テンプレは全て社長監修待ちドラフト。誤って確認済み扱いにしない。
    expect(matchEventTemplate("2026_07_whowatchgrandprix").ceoConfirmedAt).toBeNull();
    expect(DEFAULT_EVENT_TEMPLATE.ceoConfirmedAt).toBeNull();
  });
});
