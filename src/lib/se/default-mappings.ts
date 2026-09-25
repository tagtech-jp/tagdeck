// 公式の既定 SE（2026-09-25・社長の SE 設定を製品の既定に昇格）。
// ファイルは public/se/defaults/ に同梱（Supabase Storage の個人アップロードに依存しない）。
// ユーザーが同じ key に音源を上げればそちらが優先。音量・鳴らすだけ変えた場合は音源はこの既定のまま。
// 2026-09-26 社長指示「すべて社長のアカウントと同じように既定の SE に同期」: 同期元の全件（廃止キー tier:combo を除く 37 件）を同梱。
//   以前は第三者の著作物と思われる音源（任天堂コイン音など）を除外していたが、社長判断で全件同期に変更。
// 生成元: scratchpad/build_defaults_full.py（手で直す場合は key の重複に注意）

export interface DefaultSeMapping {
  key: string;
  /** 同梱ファイル（サイト相対パス） */
  url: string;
  /** 0〜100 */
  volume: number;
  label: string;
}

/**
 * 汎用の既定音（2026-09-25 社長指定「きらきら輝く1」）。
 * 価格帯（tier:T0〜T4・hit）のうち、同期元にも同梱スナップショットにも無いものはこれで鳴る（Web Audio 合成音は最後の保険）
 */
export const GENERIC_DEFAULT_SOUND = { url: "/se/defaults/kirakira.mp3", volume: 80, label: "きらきら輝く1.mp3" } as const;
export const GENERIC_DEFAULT_TIERS = ["tier:T0", "tier:T1", "tier:T2", "tier:T3", "tier:T4", "tier:hit"] as const;

export const DEFAULT_SE_MAPPINGS: readonly DefaultSeMapping[] = [
  { key: "tier:T4", url: "/se/defaults/pokyun_alert.mp3", volume: 80, label: "ポキューン！先バレ風激熱通知音.mp3" },
  { key: "item:13063", url: "/se/defaults/pokyun_alert.mp3", volume: 80, label: "ポキューン！先バレ風激熱通知音.mp3" },
  { key: "item:13062", url: "/se/defaults/pokyun_alert.mp3", volume: 80, label: "ポキューン！先バレ風激熱通知音.mp3" },
  { key: "item:10773", url: "/se/defaults/elephant.mp3", volume: 100, label: "ゾウの鳴き声1.mp3" },
  { key: "item:13065", url: "/se/defaults/harakiridrive.mp3", volume: 25, label: "harakiridrive.mp3" },
  { key: "item:13061", url: "/se/defaults/ziyagura_gako.mp3", volume: 80, label: "ziyagura-gako.mp3" },
  { key: "item:12132", url: "/se/defaults/shakin.mp3", volume: 100, label: "シャキーン2.mp3" },
  { key: "item:11146", url: "/se/defaults/dog_bark.mp3", volume: 100, label: "狂犬が連続で吠える.mp3" },
  { key: "item:10769", url: "/se/defaults/drumroll.mp3", volume: 80, label: "ドラムロール.mp3" },
  { key: "item:1", url: "/se/defaults/air_horn.mp3", volume: 80, label: "エアーホーン.mp3" },
  { key: "item:10842", url: "/se/defaults/buta.mp3", volume: 100, label: "buta.mp3" },
  { key: "item:12131", url: "/se/defaults/sea_lion.mp3", volume: 80, label: "カリフォルニアアシカ1.mp3" },
  { key: "item:134", url: "/se/defaults/fireworks.mp3", volume: 80, label: "打ち上げ花火1.mp3" },
  { key: "item:5", url: "/se/defaults/fireworks.mp3", volume: 80, label: "打ち上げ花火1.mp3" },
  { key: "item:61", url: "/se/defaults/fireworks.mp3", volume: 80, label: "打ち上げ花火1.mp3" },
  { key: "item:13088", url: "/se/defaults/cat_nya.mp3", volume: 100, label: "ani_ge_cat_nya03.mp3" },
  { key: "tier:T0", url: "/se/defaults/quiz_correct.mp3", volume: 100, label: "クイズ正解1.mp3" },
  { key: "tier:T1", url: "/se/defaults/ata_a14.mp3", volume: 80, label: "ata_a14.mp3" },
  { key: "tier:T2", url: "/se/defaults/coin.wav", volume: 80, label: "nc106374__【任天堂】コインの音【スーパーマリオ】.wav" },
  { key: "tier:T3", url: "/se/defaults/register.mp3", volume: 80, label: "レジスターで精算.mp3" },
  { key: "item:14", url: "/se/defaults/drumroll.mp3", volume: 80, label: "ドラムロール.mp3" },
  { key: "item:13064", url: "/se/defaults/star_theme.mp3", volume: 50, label: "super-mario-bros-nes-music-star-theme-cut-mp3.mp3" },
  { key: "item:11526", url: "/se/defaults/drumroll.mp3", volume: 80, label: "ドラムロール.mp3" },
  { key: "item:11716", url: "/se/defaults/drumroll.mp3", volume: 80, label: "ドラムロール.mp3" },
  { key: "item:12731", url: "/se/defaults/drumroll.mp3", volume: 80, label: "ドラムロール.mp3" },
  { key: "item:10863", url: "/se/defaults/drumroll.mp3", volume: 80, label: "ドラムロール.mp3" },
  { key: "item:11250", url: "/se/defaults/drumroll.mp3", volume: 80, label: "ドラムロール.mp3" },
  { key: "item:11960", url: "/se/defaults/drumroll.mp3", volume: 80, label: "ドラムロール.mp3" },
  { key: "item:12857", url: "/se/defaults/mouse_squeak.mp3", volume: 80, label: "ネズミの鳴き声1回.mp3" },
  { key: "item:13083", url: "/se/defaults/uguisu.mp3", volume: 80, label: "ウグイスのさえずり1.mp3" },
  { key: "item:13085", url: "/se/defaults/hiyodori.mp3", volume: 80, label: "ヒヨドリの鳴き声2.mp3" },
  { key: "item:13087", url: "/se/defaults/hiyodori.mp3", volume: 80, label: "ヒヨドリの鳴き声2.mp3" },
  { key: "item:12871", url: "/se/defaults/drumroll.mp3", volume: 80, label: "ドラムロール.mp3" },
  { key: "item:13046", url: "/se/defaults/drumroll.mp3", volume: 80, label: "ドラムロール.mp3" },
  { key: "item:13095", url: "/se/defaults/drumroll.mp3", volume: 80, label: "ドラムロール.mp3" },
  { key: "item:10837", url: "/se/defaults/drumroll.mp3", volume: 80, label: "ドラムロール.mp3" },
  { key: "item:11038", url: "/se/defaults/drumroll.mp3", volume: 80, label: "ドラムロール.mp3" },
];
