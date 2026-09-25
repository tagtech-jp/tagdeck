/**
 * ふわっちイベントランキング HTML パース
 *
 * 法務制約：
 * - whowatch.tv の公開ページのみ
 * - 認証情報・Cookie は扱わない
 * - 呼び出し間隔は呼び出し元で制御（25 秒以上）
 * - User-Agent 必須
 */

const USER_AGENT = "TagDeck/0.1 (+https://tagtech.jp)";
const TIMEOUT_MS = 8000;

export interface RankingEntry {
  rank: number;
  name: string;
  username?: string;
  score: number;
}

export class WhowatchRankingException extends Error {
  constructor(
    public code: number,
    message: string
  ) {
    super(message);
    this.name = "WhowatchRankingException";
  }
}

/**
 * イベントランキングページから全ランキングエントリを取得する。
 * パースエラー時は空配列を返し、呼び出し元で手動入力にフォールバック。
 */
export async function fetchEventRanking(rankingUrl: string): Promise<RankingEntry[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const url = new URL(rankingUrl);
    if (!url.hostname.endsWith("whowatch.tv")) {
      throw new WhowatchRankingException(400, "ふわっちの URL ではありません");
    }

    const response = await fetch(rankingUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new WhowatchRankingException(response.status, `Ranking fetch error: ${response.status}`);
    }

    const html = await response.text();
    return parseRankingHtml(html);
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof WhowatchRankingException) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new WhowatchRankingException(408, "リクエストタイムアウト");
    }
    throw new WhowatchRankingException(500, String(error));
  }
}

/**
 * HTML からランキングデータを抽出する。
 *
 * パターン 1：embedded-data script タグから JSON を抽出（優先）
 * パターン 2：HTML 構造から正規表現でフォールバック抽出
 *
 * ふわっちの HTML 構造はサイト変更で壊れる可能性があるため、
 * パース失敗時は空配列を返す。
 */
function parseRankingHtml(html: string): RankingEntry[] {
  // パターン 1：embedded-data から JSON 取得
  const embeddedMatch = html.match(/<script[^>]*id="embedded-data"[^>]*data-props="([^"]+)"/);
  if (embeddedMatch) {
    try {
      const decoded = embeddedMatch[1]
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'");

      const data = JSON.parse(decoded) as Record<string, unknown>;

      // ランキングデータの構造を探索（ふわっちのレスポンス形式に応じて調整）
      const rankings =
        (data.rankings as unknown[]) ??
        ((data.event as Record<string, unknown>)?.rankings as unknown[]) ??
        (data.entries as unknown[]) ??
        [];

      if (Array.isArray(rankings) && rankings.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return rankings.slice(0, 100).map((entry: any, index: number) => ({
          rank: (entry.rank as number) ?? index + 1,
          name:
            (entry.user as Record<string, unknown>)?.name as string ??
            (entry.name as string) ??
            `配信者${index + 1}`,
          username:
            (entry.user as Record<string, unknown>)?.account_id as string | undefined ??
            (entry.username as string | undefined),
          score: (entry.score as number) ?? (entry.point as number) ?? 0,
        }));
      }
    } catch (e) {
      console.warn("[Whowatch Ranking] embedded-data パース失敗、HTML パターンへフォールバック");
    }
  }

  // パターン 2：HTML 構造から正規表現で抽出（サイト変更で壊れる可能性あり）
  const entries: RankingEntry[] = [];
  const rowPattern =
    /<tr[^>]*data-rank="(\d+)"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>[\s\S]*?<td[^>]*class="[^"]*score[^"]*"[^>]*>([^<]+)</g;
  let match: RegExpExecArray | null;

  while ((match = rowPattern.exec(html)) !== null && entries.length < 100) {
    const rank = parseInt(match[1], 10);
    const name = match[2].trim();
    const score = parseInt(match[3].replace(/[^0-9]/g, ""), 10);

    if (!isNaN(rank) && !isNaN(score)) {
      entries.push({ rank, name, score });
    }
  }

  if (entries.length === 0) {
    console.warn("[Whowatch Ranking] ランキングデータを取得できませんでした。手動入力を使用してください。");
  }

  return entries;
}

/**
 * ランキング一覧から自分のエントリを特定し、周辺ライバルを抽出する。
 * 自分が見つからない場合は上位 N 名をライバルとして返す。
 */
export function extractRivals(
  rankings: RankingEntry[],
  myEntryName: string,
  rangeAbove = 3,
  rangeBelow = 3
): { myEntry: RankingEntry | null; rivals: RankingEntry[] } {
  const myIndex = rankings.findIndex(
    (r) => r.name === myEntryName || r.username === myEntryName
  );

  if (myIndex === -1) {
    return {
      myEntry: null,
      rivals: rankings.slice(0, rangeAbove + rangeBelow),
    };
  }

  const start = Math.max(0, myIndex - rangeAbove);
  const end = Math.min(rankings.length, myIndex + rangeBelow + 1);

  return {
    myEntry: rankings[myIndex],
    rivals: rankings
      .slice(start, end)
      .filter((r) => r.name !== myEntryName && r.username !== myEntryName),
  };
}
