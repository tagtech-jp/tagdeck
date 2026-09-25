// 公式の既定 SE（default-mappings.ts）とユーザーの se_mappings を合成する（2026-09-25）。
// 規則:
//   - ユーザー行がある key はユーザー行を使う。ただし url が null（音量や「鳴らす」だけ変えた）なら音源は既定のまま
//   - ユーザー行が無い key は既定をそのまま使う（source: "default"）
//   - 既定に無い key は従来どおり（url null なら合成音）
import { DEFAULT_SE_MAPPINGS, type DefaultSeMapping } from "./default-mappings";

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

export function mergeWithDefaults(userRows: readonly UserMappingRow[], defaults: readonly DefaultSeMapping[] = DEFAULT_SE_MAPPINGS): MergedMapping[] {
  const byKey = new Map<string, MergedMapping>();
  for (const d of defaults) {
    byKey.set(d.key, { key: d.key, url: d.url, volume: d.volume, enabled: true, label: d.label, source: "default", usesDefaultSound: true });
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

/** その key に公式既定があるか */
export function hasDefaultSound(key: string, defaults: readonly DefaultSeMapping[] = DEFAULT_SE_MAPPINGS): boolean {
  return defaults.some((d) => d.key === key);
}
