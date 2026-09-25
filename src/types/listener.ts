import type { Platform } from "./platform";

export type ListenerRank = "regular" | "vip" | "newcomer" | "top";

export interface Listener {
  id: string;
  platform: Platform;
  platformUserId: string;
  displayName: string;
  nickname?: string;
  avatarUrl?: string;
  rank: ListenerRank;
  totalGiftAmount: number;
  totalCommentCount: number;
  lastSeenAt: Date;
  firstSeenAt: Date;
  isOnline: boolean;
  notes?: string;
  tags: string[];
}

export type ListenerSortKey =
  | "lastSeenAt"
  | "totalGiftAmount"
  | "totalCommentCount"
  | "displayName";

export type SortDirection = "asc" | "desc";
