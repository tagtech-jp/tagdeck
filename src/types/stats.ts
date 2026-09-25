import type { Platform } from "./platform";

export interface StreamStats {
  platform: Platform;
  viewerCount: number;
  peakViewerCount: number;
}
