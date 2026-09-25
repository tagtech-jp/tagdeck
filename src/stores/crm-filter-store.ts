import { create } from "zustand";
import type { ListenerRank, ListenerSortKey, SortDirection } from "@/types/listener";

interface CrmFilterStore {
  searchQuery: string;
  rankFilter: ListenerRank | "all";
  onlineOnly: boolean;
  sortKey: ListenerSortKey;
  sortDirection: SortDirection;
  setSearchQuery: (query: string) => void;
  setRankFilter: (rank: ListenerRank | "all") => void;
  setOnlineOnly: (onlineOnly: boolean) => void;
  setSortKey: (key: ListenerSortKey) => void;
  setSortDirection: (direction: SortDirection) => void;
  toggleSortDirection: () => void;
}

export const useCrmFilterStore = create<CrmFilterStore>((set) => ({
  searchQuery: "",
  rankFilter: "all",
  onlineOnly: false,
  sortKey: "lastSeenAt",
  sortDirection: "desc",
  setSearchQuery: (query) => set({ searchQuery: query }),
  setRankFilter: (rank) => set({ rankFilter: rank }),
  setOnlineOnly: (onlineOnly) => set({ onlineOnly }),
  setSortKey: (key) => set({ sortKey: key }),
  setSortDirection: (direction) => set({ sortDirection: direction }),
  toggleSortDirection: () =>
    set((state) => ({
      sortDirection: state.sortDirection === "asc" ? "desc" : "asc",
    })),
}));
