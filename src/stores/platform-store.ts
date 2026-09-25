import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PlatformFilter } from "@/types/platform";

interface PlatformStore {
  selectedPlatform: PlatformFilter;
  setPlatform: (platform: PlatformFilter) => void;
}

export const usePlatformStore = create<PlatformStore>()(
  persist(
    (set) => ({
      selectedPlatform: "all",
      setPlatform: (platform) => set({ selectedPlatform: platform }),
    }),
    {
      name: "tagdeck-platform-store",
    }
  )
);
