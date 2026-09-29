// 公式の既定 SE の同梱スナップショット（同期元が読めないときの予備・2026-09-30 正式リリースで CC0 に差し替え・S23）。
// ファイルは public/se/defaults/cc0/ に同梱（出典とライセンスは同じフォルダの defaults.json）。
// ユーザーが同じ key に音源を上げればそちらが優先。音量・鳴らすだけ変えた場合は音源はこの既定のまま。
//
// 経緯: 2026-09-25〜26 は社長の割り当てを音源ごと同梱していた（任天堂・パチスロ由来の音や、再配布を禁じる素材サイトの音を含む）。
//   2026-09-30 社長指示「正式にリリースする手順にしたいので、著作権のあるものは弾いて別の音源に差し替えてほしい」で、
//   同じ割り当て（2026-09-30 時点の同期元 81 件のうちアイテム 75 件）を、同種の CC0 の音に置き換えた（cleared-defaults.ts）。
//   価格帯（tier:*）は自動ライブラリ（CC0）が鳴るので同梱しない。

import { CLEARED_SOUNDS, clearedSoundLabel, clearedSoundUrl, type ClearedSoundId } from "./cleared-defaults";

export interface DefaultSeMapping {
  key: string;
  /** 同梱ファイル（サイト相対パス） */
  url: string;
  /** 0〜100 */
  volume: number;
  label: string;
}

/**
 * 汎用の既定音。価格帯（tier:T0〜T4・hit）は再生・試聴とも自動ライブラリの価格帯セットが鳴るので、
 * これは自動ライブラリが無いときだけの予備（2026-09-30 に「きらきら輝く1」から CC0 のきらきらへ）
 */
export const GENERIC_DEFAULT_SOUND = { url: clearedSoundUrl("chime"), volume: CLEARED_SOUNDS.chime.volume, label: clearedSoundLabel("chime") } as const;
export const GENERIC_DEFAULT_TIERS = ["tier:T0", "tier:T1", "tier:T2", "tier:T3", "tier:T4", "tier:hit"] as const;

/** 同期元（2026-09-30 時点）のアイテム割り当て → 置き換え先の CC0 の音 */
const SNAPSHOT: Readonly<Partial<Record<ClearedSoundId, readonly number[]>>> = {
  // ポキューン！先バレ風激熱通知音 → 激熱の告知音（ギンギラギン流星群・もりあげねこさん・突入ボーナス）
  jackpot_alert: [13062, 13063, 13101],
  // ゾウの鳴き声1（イベント応援するゾウ！ 各月）
  elephant: [10773, 11048, 11136, 11313, 11465, 11645, 11861, 12028, 12206, 12415, 12596, 12800, 13032],
  // harakiridrive → ダンスのジングル（ギンギラギンもりあげねこさんのダンスパーティ）
  dance_jingle: [13065],
  // ziyagura-gako → 金属音（ギンギラギン隕石）
  slot_clunk: [13061],
  // シャキーン2（もぐりながら応援するもぐらさん）
  sparkle_shing: [12132],
  // 狂犬が連続で吠える（ワンチャン33倍の応援をするワンちゃんさん 各月）
  dog_bark: [11146, 11315, 11467, 11647, 11863, 12030, 12208, 12417, 12598, 12802, 13034],
  // x3_vol5 → ぶたの鳴き声（トンでもない応援をするぶたさん 各月）
  pig_oink: [10842, 11049, 11137, 11314, 11466, 11646, 11862, 12029, 12207, 12416, 12597, 12801, 13033],
  // エアーホーン（風船）
  air_horn: [1],
  // 打ち上げ花火1（花火・大花火ほか）
  fireworks: [5, 61, 134],
  // ani_ge_cat_nya03（オータムコレクション）
  cat_meow: [13088],
  // ドラムロール（メガホン各種）
  drumroll: [14, 10769, 10837, 10863, 11038, 11250, 11526, 11716, 11891, 11960, 12731, 12871, 13046, 13095],
  // スターのテーマ → きらめきのジングル（ギンギラギンギャラクシーオーロラ）
  star_jingle: [13064],
  // ネズミの鳴き声1回（チューと半端な応援をするネズミさん・金のネズミさん）
  mouse_squeak: [11243, 12857],
  // ウグイスのさえずり1（どんぐり）
  bird_song: [13083],
  // ヒヨドリの鳴き声2（どんぐり帽子）
  bird_chirp: [13085, 13087],
  // 「出でよ、我がしもべよ！」 → 召喚の魔法（おばあさんたぬっち）
  summon_magic: [13100],
  // シカ（たしかな応援をするシカさん 各月）
  deer_call: [12131, 12209, 12418, 12599, 12803, 13035],
};

export const DEFAULT_SE_MAPPINGS: readonly DefaultSeMapping[] = (Object.entries(SNAPSHOT) as Array<[ClearedSoundId, readonly number[]]>).flatMap(([id, items]) =>
  items.map((itemId) => ({ key: `item:${itemId}`, url: clearedSoundUrl(id), volume: CLEARED_SOUNDS[id].volume, label: clearedSoundLabel(id) })),
);
