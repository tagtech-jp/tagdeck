// 公式既定からパック由来の行を外す（2026-10-18 社長決定「メインアカウントでもパックを鳴らしたい」・案 B）。
// 同期元（SE_DEFAULT_SOURCE_USER_ID）のアカウントに音源パック（Storage の {user}/pack/…・scripts/se/pack-pipeline.ts）を
// 登録しても、他の利用者に配る公式既定は変えない: パック由来の行は、同梱スナップショット（default-mappings.ts・2026-09-30
// 時点の公式既定）の同じ key の行で代用し、スナップショットに無い key（パックが足した #2〜#5 など）は配らない。
// パック以外の行（S24 で CC0 に置き換えた行・手で変えた行）はそのまま。/api/se/mappings の GET から使う純関数。
//
// 背景: 2026-10-17 に同期元（メイン）へパックを本実行したところ、259 アイテム分の公式既定が「ファイル名から推定した CC0」に
// 置き換わるか配られなくなった（cleared-defaults.ts は URL で CC0 を判定し、それ以外はラベルから推定するため）。

export interface DefaultSourceRow {
  key: string;
  url: string | null;
  volume: number;
  enabled: boolean;
  label: string | null;
}

export interface SnapshotRow {
  key: string;
  url: string;
  volume: number;
  label: string;
}

/** 音源パックが置く Storage のパス（{user}/pack/{hash}_{name}.mp3）か */
export function isPackUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && /\/pack\//.test(url);
}

/**
 * パック由来の行をスナップショットの同じ key の行で置き換え、無ければ外す。それ以外の行は触らない。順序は元のまま
 */
export function substitutePackRows<T extends DefaultSourceRow>(rows: readonly T[], snapshot: readonly SnapshotRow[]): T[] {
  const byKey = new Map(snapshot.map((s) => [s.key, s] as const));
  const out: T[] = [];
  for (const r of rows) {
    if (!isPackUrl(r.url)) {
      out.push(r);
      continue;
    }
    const s = byKey.get(r.key);
    if (s) out.push({ ...r, url: s.url, volume: s.volume, label: s.label });
  }
  return out;
}
