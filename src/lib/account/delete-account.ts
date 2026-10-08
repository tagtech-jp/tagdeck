// 退会（アカウント削除）の純粋な部品（2026-10-08・セキュリティ監査 §3-7）。
// Route Handler（src/app/api/account/delete/route.ts）と画面（src/components/settings/DeleteAccountSection.tsx）の両方から
// import するため、サーバ専用の実装（next/headers・DB）には依存しない。

/** 画面で利用者に入力してもらい、API にそのまま送る確認の語（誤操作の防止） */
export const CONFIRM_WORD = "削除";

/** SE 音源バケット（Storage）の 1 回の一覧の上限。Supabase の既定は 100 件 */
export const STORAGE_LIST_PAGE = 1000;

export interface StorageListEntry {
  name: string;
  /** フォルダは id が null で返る（ファイルだけを消す） */
  id: string | null;
}

export interface StorageListResult {
  data: StorageListEntry[] | null;
  error: { message: string } | null;
}

export type StorageListFn = (opts: { limit: number; offset: number }) => Promise<StorageListResult>;

/** 一覧の暴走を止める上限（1 人の音源は多くて数百本） */
const STORAGE_LIST_MAX_OBJECTS = 100_000;

/**
 * 本人のフォルダ（{userId}/…）にあるファイルのパスを全部集める（storage.remove に渡す形）。
 * 1 ページが上限いっぱいなら次のページも読む。失敗は Error で投げる（呼び出し元が 502 にする）
 */
export async function listAllOwnStorageObjects(list: StorageListFn, userId: string, pageSize = STORAGE_LIST_PAGE): Promise<string[]> {
  const paths: string[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await list({ limit: pageSize, offset });
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const row of rows) {
      if (row.id === null || row.id === undefined) continue; // フォルダ
      paths.push(`${userId}/${row.name}`);
    }
    if (rows.length < pageSize) return paths;
    if (paths.length >= STORAGE_LIST_MAX_OBJECTS) throw new Error(`storage list: too many objects (${paths.length})`);
  }
}

export interface RpcErrorLike {
  code?: string | null;
  message?: string | null;
}

/**
 * DB の関数 delete_own_account がまだ無い（drizzle/0025 未適用）か。
 * PostgREST はスキーマキャッシュに無い関数を PGRST202、PostgreSQL は 42883（undefined_function）で返す
 */
export function isFunctionMissingError(error: RpcErrorLike | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  return /could not find the function/i.test(error.message ?? "");
}
