// サーバ間呼び出し（cron 等）用の共有キー検証。Route ファイルは POST 以外を export できないため lib に置く。

export type SyncKeyVerdict = { ok: true } | { ok: false; reason: string };

/** 共有キーの検証。長さ一致 + 定数時間比較で照合する */
export function verifySyncKey(given: string | null, expected: string | undefined): SyncKeyVerdict {
  if (!expected) return { ok: false, reason: "RANKING_SYNC_KEY not configured" };
  if (!given) return { ok: false, reason: "missing X-Sync-Key" };
  if (given.length !== expected.length) return { ok: false, reason: "invalid X-Sync-Key" };
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? { ok: true } : { ok: false, reason: "invalid X-Sync-Key" };
}
