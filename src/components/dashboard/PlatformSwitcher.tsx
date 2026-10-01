"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { usePlatformStore } from "@/stores/platform-store";
import { PLATFORM_LABELS, type PlatformFilter } from "@/types/platform";

const ITEM_CLASS = "h-10 flex-1 text-xs md:h-8 md:flex-none";

export function PlatformSwitcher() {
  const { selectedPlatform, setPlatform } = usePlatformStore();

  return (
    <ToggleGroup
      value={[selectedPlatform]}
      onValueChange={(values: string[]) => {
        const last = values[values.length - 1];
        if (last) setPlatform(last as PlatformFilter);
      }}
      // SP: full width with 4 equal 40px-tall buttons (easier to tap); md+: fits its content as before
      className="w-full rounded-lg bg-muted p-1 md:w-fit"
    >
      <ToggleGroupItem value="all" className={ITEM_CLASS}>
        全部
      </ToggleGroupItem>
      <ToggleGroupItem value="whowatch" className={ITEM_CLASS}>
        {PLATFORM_LABELS.whowatch}
      </ToggleGroupItem>
      <ToggleGroupItem value="kick" className={ITEM_CLASS}>
        {PLATFORM_LABELS.kick}
      </ToggleGroupItem>
      <ToggleGroupItem value="niconico" className={ITEM_CLASS}>
        {PLATFORM_LABELS.niconico}
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
