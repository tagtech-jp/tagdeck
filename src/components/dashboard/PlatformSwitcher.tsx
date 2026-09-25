"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { usePlatformStore } from "@/stores/platform-store";
import { PLATFORM_LABELS, type PlatformFilter } from "@/types/platform";

export function PlatformSwitcher() {
  const { selectedPlatform, setPlatform } = usePlatformStore();

  return (
    <ToggleGroup
      value={[selectedPlatform]}
      onValueChange={(values: string[]) => {
        const last = values[values.length - 1];
        if (last) setPlatform(last as PlatformFilter);
      }}
      className="rounded-lg bg-muted p-1"
    >
      <ToggleGroupItem value="all" className="text-xs">
        全部
      </ToggleGroupItem>
      <ToggleGroupItem value="whowatch" className="text-xs">
        {PLATFORM_LABELS.whowatch}
      </ToggleGroupItem>
      <ToggleGroupItem value="kick" className="text-xs">
        {PLATFORM_LABELS.kick}
      </ToggleGroupItem>
      <ToggleGroupItem value="niconico" className="text-xs">
        {PLATFORM_LABELS.niconico}
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
