import { users } from "./schema";
import type { createDbClient } from "./client";

type Db = ReturnType<typeof createDbClient>;

/** supabase.auth.getUser() が返す User のうち、この処理に必要な部分 */
export interface AuthUserLike {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * public.users に auth ユーザーの行を保証する（冪等）。
 *
 * - 通常は auth.users の AFTER INSERT トリガー（drizzle/0009）が作成済みだが、
 *   トリガー導入前のユーザーやトリガー失敗時の保険としてアプリ側でも呼ぶ。
 * - 衝突を無視するのは id（同一ユーザー）だけ。email の一意制約違反は黙殺せず
 *   そのまま投げる（別ユーザーとメールが重複している異常を隠さないため）。
 * - email が無い OAuth ユーザーは email = NULL で登録する。
 */
export async function ensureUserRow(db: Db, user: AuthUserLike): Promise<void> {
  await db
    .insert(users)
    .values({
      id: user.id,
      email: nonEmpty(user.email),
      displayName: nonEmpty(user.user_metadata?.display_name),
    })
    .onConflictDoNothing({ target: users.id });
}
