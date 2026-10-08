import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CONFIRM_WORD, isFunctionMissingError, listAllOwnStorageObjects } from "@/lib/account/delete-account";

/**
 * POST /api/account/delete → 退会（本人のアカウントとデータの削除・2026-10-08・セキュリティ監査 §3-7）
 * - 本人確認はログイン（Cookie か Authorization: Bearer）。本文 { confirm: "削除" } が無ければ 400（画面で入力させる誤操作の防止）
 * - 別サイトからの POST は middleware の Origin ガードが 403 にする（src/lib/origin-guard.ts）
 * - 順番: (1) Storage（バケット se の {user_id}/…）を本人の権限で消す → (2) DB の関数 delete_own_account() を本人として呼ぶ
 *   （public の各表から auth.users まで 1 トランザクションで消える。drizzle/0025）→ (3) ログイン Cookie を消す
 *   Storage を先にするのは、SQL で storage.objects を消すとファイル実体が残るのと、(2) の後では本人の権限が無くなるため。
 *   (1) で失敗したら (2) はしない（途中までの削除を残さない。利用者はやり直せる）
 * - 関数が未適用（drizzle/0025 の前）なら 503 { reason: "function_missing" }。適用より先にマージしても壊れない
 * - 応答: 200 { ok: true, deleted: {表ごとの行数}, storageObjects } / 401 / 400 / 502（Storage）/ 503（未適用）/ 500
 * - 消える表の一覧と運用: docs/ops/account_deletion_20261008.md
 */
export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return noStore(NextResponse.json({ error: "unauthorized" }, { status: 401 }));

  const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null;
  if (body?.confirm !== CONFIRM_WORD) {
    return noStore(NextResponse.json({ error: `確認のため confirm に「${CONFIRM_WORD}」を入れてください`, reason: "confirm" }, { status: 400 }));
  }

  // (1) Storage（本人の権限。0014 の "se: own delete" ポリシーで自分のフォルダだけ消せる）
  const bucket = supabase.storage.from("se");
  let paths: string[];
  try {
    paths = await listAllOwnStorageObjects((opts) => bucket.list(user.id, opts), user.id);
  } catch (e) {
    console.error(`[account/delete] 音源の一覧に失敗 user=${user.id}: ${messageOf(e)}`);
    return noStore(NextResponse.json({ error: "音源の一覧に失敗しました。時間をおいてやり直してください", reason: "storage_list" }, { status: 502 }));
  }
  if (paths.length > 0) {
    const { error } = await bucket.remove(paths);
    if (error) {
      console.error(`[account/delete] 音源の削除に失敗 user=${user.id} files=${paths.length}: ${error.message}`);
      return noStore(NextResponse.json({ error: "音源の削除に失敗しました。時間をおいてやり直してください", reason: "storage_remove" }, { status: 502 }));
    }
  }

  // (2) DB（本人の行だけ。関数の中身と消える表は drizzle/0025_delete_own_account.sql）
  const { data, error } = await supabase.rpc("delete_own_account");
  if (error) {
    if (isFunctionMissingError(error)) {
      console.error(`[account/delete] 関数 delete_own_account が未適用（drizzle/0025）: ${error.message}`);
      return noStore(
        NextResponse.json({ error: "退会の機能はまだ準備中です。お問い合わせフォームからご連絡ください", reason: "function_missing" }, { status: 503 }),
      );
    }
    console.error(`[account/delete] 削除に失敗 user=${user.id} code=${error.code ?? "-"}: ${error.message}`);
    return noStore(NextResponse.json({ error: "退会に失敗しました。時間をおいてやり直してください", reason: error.code ?? "rpc_failed" }, { status: 500 }));
  }

  // (3) ログイン Cookie。Supabase 側のセッションは auth.users と一緒に消えている（logout の 401/403/404 は supabase-js が無視する）
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch (e) {
    console.warn(`[account/delete] signOut 失敗（削除は完了している）: ${messageOf(e)}`);
  }
  console.log(`[account/delete] 退会 user=${user.id} storage=${paths.length} ${JSON.stringify(data)}`);
  return noStore(NextResponse.json({ ok: true, deleted: data, storageObjects: paths.length }));
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function noStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
