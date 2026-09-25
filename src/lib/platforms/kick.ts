/**
 * Kick プラットフォームアダプター
 *
 * 法務制約：
 * - 公開 REST API（kick.com/api/v2）のみ使用
 * - 公開 Pusher アプリキーで読み取り専用 WebSocket 接続
 * - 書き込み API は使用しない
 */

const KICK_API_BASE = "https://kick.com/api/v2";
const USER_AGENT = "TagDeck/0.1 (+https://tagtech.jp)";

export const KICK_PUSHER_CONFIG = {
  appKey: "32cbd69e4b950bf97679",
  cluster: "us2",
} as const;

export interface KickChannelInfo {
  channelId: string;
  username: string;
  slug: string;
  chatroomId: string;
  followerCount: number;
  isLive: boolean;
  liveTitle?: string;
  viewerCount: number;
  startedAt: Date | null;
}

export class KickApiException extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
    this.name = "KickApiException";
  }
}

/**
 * チャンネル情報取得（公開エンドポイント・認証不要）
 */
export async function fetchKickChannel(
  username: string,
): Promise<KickChannelInfo | null> {
  let response: Response;
  try {
    response = await fetch(
      `${KICK_API_BASE}/channels/${encodeURIComponent(username)}`,
      {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      },
    );
  } catch (error) {
    throw new KickApiException(500, String(error));
  }

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new KickApiException(response.status, `Kick API error: ${response.status}`);
  }

  // Kick 公開 API の channel 応答のうち、ここで読むフィールドだけを型にする
  const data = (await response.json()) as {
    id?: number | string;
    slug?: string;
    user?: { username?: string };
    chatroom?: { id?: number | string };
    followers_count?: number;
    livestream?: { session_title?: string; viewer_count?: number; created_at?: string } | null;
  };

  return {
    channelId: String(data.id),
    username: data.user?.username ?? username,
    slug: data.slug ?? username,
    chatroomId: String(data.chatroom?.id ?? ""),
    followerCount: data.followers_count ?? 0,
    isLive: !!data.livestream,
    liveTitle: data.livestream?.session_title ?? undefined,
    viewerCount: data.livestream?.viewer_count ?? 0,
    startedAt: data.livestream?.created_at ? new Date(data.livestream.created_at) : null,
  };
}

/**
 * Pusher イベント名（Kick 公式 Pusher で配信されるイベント）
 */
export const KICK_PUSHER_EVENTS = {
  CHAT_MESSAGE: "App\\Events\\ChatMessageEvent",
  GIFTED_SUBSCRIPTIONS: "App\\Events\\GiftedSubscriptionsEvent",
  SUBSCRIPTION: "App\\Events\\SubscriptionEvent",
  STREAMER_IS_LIVE: "App\\Events\\StreamerIsLive",
  STOP_STREAM: "App\\Events\\StopStreamBroadcast",
  USER_BANNED: "App\\Events\\UserBannedEvent",
} as const;

export function getKickChatChannelName(chatroomId: string): string {
  return `chatrooms.${chatroomId}.v2`;
}

export function getKickChannelChannelName(channelId: string): string {
  return `channel.${channelId}`;
}

export function buildKickLiveUrl(username: string | null | undefined): string | null {
  if (!username) return null;
  return `https://kick.com/${encodeURIComponent(username)}`;
}
