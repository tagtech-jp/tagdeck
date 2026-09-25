// 公式の既定 SE とユーザーの se_mappings を合成する（2026-09-25）。
// 既定の優先順:
//   1. 同期元ユーザー（社長）の現在の割り当て（/api/se/mappings の defaults。アップロードし直せば次の読込から反映）
//   2. 同梱スナップショット（default-mappings.ts。同期元が未設定・0 件のとき）
//   3. 汎用既定「きらきら輝く1」（価格帯のうち 1・2 に無いもの）
// 規則:
//   - ユーザー行がある key はユーザー行を使う。ただし url が null（音量や「鳴らす」だけ変えた）なら音源は既定のまま
//   - ユーザー行が無い key は既定をそのまま使う（source: "default"）
//   - 既定に無い key は従来どおり（url null なら合成音）
import { DEFAULT_SE_MAPPINGS, GENERIC_DEFAULT_SOUND, GENERIC_DEFAULT_TIERS, type DefaultSeMapping } from "./default-mappings";

export interface MergedMapping {
  key: string;
  url: string | null;
  volume: number;
  enabled: boolean;
  label: string | null;
  /** user = 自分の行 / default = 公式既定（自分の行なし） */
  source: "user" | "default";
  /** 音源だけ公式既定を使っている（自分の行は音量・鳴らすのみ） */
  usesDefaultSound: boolean;
}

export interface UserMappingRow {
  key: string;
  url: string | null;
  volume: number;
  enabled: boolean;
  label?: string | null;
}

/** /api/se/mappings の defaults（同期元の行）を既定の形にする。url の無い行・鳴らす OFF の行は既定にしない */
export function liveDefaultsToMappings(rows: readonly UserMappingRow[] | null | undefined): DefaultSeMapping[] | null {
  if (!rows || rows.length === 0) return null;
  const out = rows.filter((r) => r.enabled && typeof r.url === "string" && r.url !== "").map((r) => ({ key: r.key, url: r.url as string, volume: r.volume, label: r.label ?? "公式音源" }));
  return out.length > 0 ? out : null;
}

export function mergeWithDefaults(
  userRows: readonly UserMappingRow[],
  liveDefaults: readonly UserMappingRow[] | null = null,
  bundled: readonly DefaultSeMapping[] = DEFAULT_SE_MAPPINGS,
  generic: { url: string; volume: number; label: string } | null = GENERIC_DEFAULT_SOUND,
): MergedMapping[] {
  const byKey = new Map<string, MergedMapping>();
  const defaults = liveDefaultsToMappings(liveDefaults) ?? bundled;
  for (const d of defaults) {
    byKey.set(d.key, { key: d.key, url: d.url, volume: d.volume, enabled: true, label: d.label, source: "default", usesDefaultSound: true });
  }
  if (generic) {
    for (const key of GENERIC_DEFAULT_TIERS) {
      if (!byKey.has(key)) byKey.set(key, { key, url: generic.url, volume: generic.volume, enabled: true, label: generic.label, source: "default", usesDefaultSound: true });
    }
  }
  for (const r of userRows) {
    const d = byKey.get(r.key);
    const useDefaultSound = r.url === null && d !== undefined && d.source === "default";
    byKey.set(r.key, {
      key: r.key,
      url: useDefaultSound ? d.url : r.url,
      volume: r.volume,
      enabled: r.enabled,
      label: useDefaultSound ? d.label : (r.label ?? null),
      source: "user",
      usesDefaultSound: useDefaultSound,
    });
  }
  return [...byKey.values()];
}

/** その key に公式既定があるか（同梱 + 汎用価格帯） */
export function hasDefaultSound(key: string, defaults: readonly DefaultSeMapping[] = DEFAULT_SE_MAPPINGS): boolean {
  return defaults.some((d) => d.key === key) || (GENERIC_DEFAULT_TIERS as readonly string[]).includes(key);
}
