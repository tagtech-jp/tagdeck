// 配信プラットフォームID入力の正規化（R9 迷3対策）。
// プロフィールURLを貼り付けた場合にハンドル/ID部分だけを自動抽出する。
// 認証・保存側のバリデーションロジックは一切変更しない（入力補助のみ）。

export type PlatformKind = "whowatch" | "kick" | "niconico";

const URL_PATTERNS: Record<PlatformKind, RegExp> = {
  // /profile/ を挟む形式（実URL: whowatch.tv/profile/w:xxx）では prefix ごと残す
  whowatch: /whowatch\.tv\/(?:profile\/)?@?((?:(?:w|t|ふ):)?[A-Za-z0-9_]+)/i,
  kick: /kick\.com\/([A-Za-z0-9_]+)/i,
  niconico: /nicovideo\.jp\/user\/(\d+)/i,
};

/**
 * プロフィールURLが貼り付けられた場合はID部分を抽出し、そうでなければ
 * 前後の空白を除去した値をそのまま返す（@の有無等は既存のサーバー側検証に委ねる）。
 */
export function normalizePlatformId(raw: string, platform: PlatformKind): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const match = trimmed.match(URL_PATTERNS[platform]);
  return match ? match[1] : trimmed;
}
