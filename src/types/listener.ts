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
  /** ギフトの定価の合計（円）。whowatch は total_yen の累計（1pt = ¥1）、Kick は金額が取れないので 0（2026-10-08・単位を円に統一） */
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
  | "totalGiftAmount" // 累計ギフト（定価の合計・円）
  | "totalCommentCount"
  | "displayName";

export type SortDirection = "asc" | "desc";
