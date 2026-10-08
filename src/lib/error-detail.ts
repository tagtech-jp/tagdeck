/**
 * エラー応答に付ける詳細（セキュリティ監査 2026-10-08 §3-9）。
 *
 * 本番（NODE_ENV=production）では `detail` を応答に含めない。describeDbError() の要約には列名・制約名・
 * 上流 API の文言が残るので、ログイン済みの利用者にそのまま返さず、呼び出し側の console.error
 * （Workers Logs）にだけ残す。開発・テストでは従来どおり `detail` を返す（手元で原因をすぐ見るため）。
 *
 * 使い方: NextResponse.json({ error: "…できませんでした", ...errorDetail(message) }, { status })
 * NODE_ENV は next build が "production" に固定するので、本番の Worker では常に空になる。
 */
export function errorDetail(message: string): { detail?: string } {
  return process.env.NODE_ENV === "production" ? {} : { detail: message };
}
