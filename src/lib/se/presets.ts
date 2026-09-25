// S2: SE プリセット（2026-09-25）
// se_mappings の一式（価格帯の既定・種類・カテゴリ・アイテム・パターン）に名前を付けて保存し、
// 8 文字の共有コードで他のユーザーがそのまま取り込めるようにする。ここは純関数のみ（DB 操作は presets-db.ts）。
//
// 音源の扱い: カスタム音源 URL は所有者の Storage（バケット se・公開読み取り）をそのまま指す。
// 取り込む側にファイルを複製しないため、所有者が音源を差し替え・削除すると取り込んだ側も変わる（README S2 に明記）。

/** se_mappings.key の書式（/api/se/mappings と同じ） */
export const SE_KEY_RE = /^(pattern:\d{1,10}|item:\d{1,10}|cat:kind:(normal|hit|anim)|cat:group:[A-Za-z0-9_#-]{1,64}|tier:(T0|T1|T2|T3|T4|hit))$/;

export interface SePresetMapping {
  key: string;
  url: string | null;
  volume: number;
  enabled: boolean;
  label: string | null;
}

export type PresetApplyMode = "replace" | "merge";

/** 紛らわしい I / O / 0 / 1 を除いた 32 文字 */
export const SHARE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const SHARE_CODE_LENGTH = 8;
export const SHARE_CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;
/** 1 プリセットに入れられる割り当て数の上限（se_mappings の実運用は数十〜数百件） */
export const MAX_PRESET_MAPPINGS = 2000;
export const PRESET_NAME_MAX = 60;
export const PRESET_DESCRIPTION_MAX = 300;
/** 共有 URL のクエリ名（/live?sePreset=CODE で取り込み欄に自動入力） */
export const SHARE_QUERY_PARAM = "sePreset";

/** 共有コードを生成する。乱数は crypto.getRandomValues（Workers / ブラウザ / Node 共通） */
export function generateShareCode(randomBytes?: Uint8Array): string {
  const bytes = randomBytes ?? crypto.getRandomValues(new Uint8Array(SHARE_CODE_LENGTH));
  let out = "";
  for (let i = 0; i < SHARE_CODE_LENGTH; i++) out += SHARE_CODE_ALPHABET[bytes[i % bytes.length] % SHARE_CODE_ALPHABET.length];
  return out;
}

/**
 * 入力された共有コードを正規化する。共有 URL（…?sePreset=CODE）を貼られてもコードだけ取り出す。
 * 小文字・空白・ハイフンは許容。書式に合わなければ null
 */
export function normalizeShareCode(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let candidate = raw;
  const m = raw.match(new RegExp(`[?&]${SHARE_QUERY_PARAM}=([^&#\\s]+)`, "i"));
  if (m) candidate = decodeURIComponent(m[1]);
  const code = candidate.toUpperCase().replace(/[\s-]/g, "");
  return SHARE_CODE_RE.test(code) ? code : null;
}

export function buildShareUrl(origin: string, code: string): string {
  return `${origin.replace(/\/$/, "")}/live?${SHARE_QUERY_PARAM}=${code}`;
}

/**
 * se_mappings の行（または取り込むプリセットの配列）を検証して SePresetMapping[] にする。
 * - key の書式外・重複は捨てる（先勝ち）
 * - url は allowedHost（Supabase Storage のホスト）以外なら既定音（null）に落とす
 * - volume は 0〜100 の整数に丸める
 */
export function toPresetMappings(rows: unknown, opts: { allowedHost?: string | null } = {}): SePresetMapping[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const out: SePresetMapping[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    if (!r || typeof r !== "object") continue;
    const key = typeof r.key === "string" ? r.key : "";
    if (!SE_KEY_RE.test(key) || seen.has(key)) continue;
    seen.add(key);
    let url: string | null = typeof r.url === "string" && r.url ? r.url : null;
    if (url) {
      try {
        const host = new URL(url).host;
        if (url.length > 2000 || (opts.allowedHost && host !== opts.allowedHost)) url = null;
      } catch {
        url = null;
      }
    }
    const volumeRaw = typeof r.volume === "number" && Number.isFinite(r.volume) ? r.volume : 80;
    const volume = Math.min(100, Math.max(0, Math.round(volumeRaw)));
    const enabled = typeof r.enabled === "boolean" ? r.enabled : true;
    const label = typeof r.label === "string" && r.label ? r.label.slice(0, 100) : null;
    out.push({ key, url, volume, enabled, label });
    if (out.length >= MAX_PRESET_MAPPINGS) break;
  }
  return out;
}

/** 取り込み結果を手元で計算する（replace = 置き換え / merge = 上書き追加）。DB 適用と同じ規則 */
export function mergeMappings(current: SePresetMapping[], incoming: SePresetMapping[], mode: PresetApplyMode): SePresetMapping[] {
  if (mode === "replace") return [...incoming];
  const byKey = new Map(current.map((m) => [m.key, m]));
  for (const m of incoming) byKey.set(m.key, m);
  return [...byKey.values()];
}

export interface PresetSummary {
  total: number;
  tiers: number;
  kinds: number;
  groups: number;
  items: number;
  patterns: number;
  customSounds: number;
}

/** 取り込み前の確認表示用に内訳を数える */
export function summarizeMappings(mappings: SePresetMapping[]): PresetSummary {
  const s: PresetSummary = { total: mappings.length, tiers: 0, kinds: 0, groups: 0, items: 0, patterns: 0, customSounds: 0 };
  for (const m of mappings) {
    if (m.key.startsWith("tier:")) s.tiers++;
    else if (m.key.startsWith("cat:kind:")) s.kinds++;
    else if (m.key.startsWith("cat:group:")) s.groups++;
    else if (m.key.startsWith("item:")) s.items++;
    else if (m.key.startsWith("pattern:")) s.patterns++;
    if (m.url) s.customSounds++;
  }
  return s;
}
