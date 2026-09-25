export type Platform = "whowatch" | "kick" | "niconico";

export const PLATFORM_LABELS: Record<Platform, string> = {
  whowatch: "ふわっち",
  kick: "Kick",
  niconico: "ニコ生",
};

export const PLATFORM_COLORS: Record<Platform, string> = {
  whowatch: "#ff6b9d",
  kick: "#53fc18",
  niconico: "#252525",
};

export type PlatformFilter = Platform | "all";
