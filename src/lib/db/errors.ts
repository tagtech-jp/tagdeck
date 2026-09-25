import { NextResponse } from "next/server";

/** PostgreSQL SQLSTATE */
export const PG_FOREIGN_KEY_VIOLATION = "23503";
export const PG_UNIQUE_VIOLATION = "23505";

/** drizzle は DrizzleQueryError で包むことがあるため、本体と cause の両方から SQLSTATE を取り出す */
export function pgErrorCode(err: unknown): string | null {
  const pick = (e: unknown) =>
    typeof e === "object" && e !== null && typeof (e as { code?: unknown }).code === "string"
      ? ((e as { code: string }).code)
      : null;
  return pick(err) ?? pick((err as { cause?: unknown } | null)?.cause) ?? null;
}

/**
 * DB 制約違反を 409 の JSON レスポンスに変換する。該当しなければ null（呼び出し側で従来どおり扱う）。
 */
export function dbConstraintErrorResponse(err: unknown): NextResponse | null {
  const code = pgErrorCode(err);
  if (code === PG_FOREIGN_KEY_VIOLATION) {
    return NextResponse.json(
      {
        error:
          "ユーザー情報の初期化が完了していません。いったんログアウトして再ログインした後、もう一度お試しください。",
        code: "USER_NOT_INITIALIZED",
      },
      { status: 409 },
    );
  }
  if (code === PG_UNIQUE_VIOLATION) {
    return NextResponse.json(
      { error: "同じ内容のデータが既に登録されています。", code: "DUPLICATE" },
      { status: 409 },
    );
  }
  return null;
}
