// 公式既定として他の利用者に配る音（2026-09-30 正式リリース・社長指示「著作権のあるものは弾いて別の音源に差し替えてほしい」・S23）。
//
// 背景: 公式既定は同期元（社長）の割り当てをそのまま全員に配っていた（S4）。社長がアップロードした音には
//   ゲーム・パチスロ由来など第三者の著作物や、アプリでの再配布を禁じる素材サイトの音が含まれるため、正式リリースでは配らない。
// 方針:
//   - 他の利用者に配るのは、出典とライセンス（CC0 1.0）を確認して同梱した音だけ（public/se/defaults/cc0/・出典は defaults.json）
//   - 同期元の行は「どんな音か」（ファイル名）で CC0 の同種の音に置き換えて配る（例: ドラムロール.mp3 → CC0 のドラムロール）
//   - 置き換え先が決まらない音と、価格帯（tier:*）の行は配らない（その場合は自動ライブラリ＝CC0 の音が鳴る）
//   - 社長自身の割り当て（自分の行）は変えない（自分の画面では自分の行が優先される）
// 新しい種類の音を公式既定にしたいとき: CC0 の音を public/se/defaults/cc0/ に足し（scripts/se/cc0_picks.py の DEFAULT_PICKS → scripts/se/build_se_cc0.py defaults）、
//   CLEARED_SOUNDS と LABEL_RULES に 1 行ずつ足す。手順は docs/live-cockpit/README.md S23。

export const CLEARED_SOUNDS = {
  drumroll: { label: "ドラムロール", volume: 80 },
  elephant: { label: "ゾウの鳴き声", volume: 80 },
  dog_bark: { label: "犬の鳴き声", volume: 80 },
  pig_oink: { label: "ぶたの鳴き声", volume: 80 },
  fireworks: { label: "打ち上げ花火", volume: 80 },
  air_horn: { label: "エアホーン", volume: 80 },
  cat_meow: { label: "ねこの鳴き声", volume: 80 },
  mouse_squeak: { label: "ネズミの鳴き声", volume: 80 },
  bird_song: { label: "小鳥のさえずり", volume: 80 },
  bird_chirp: { label: "小鳥の鳴き声", volume: 80 },
  sparkle_shing: { label: "シャキーン", volume: 80 },
  jackpot_alert: { label: "激熱の告知音", volume: 80 },
  slot_clunk: { label: "ガコッ（金属音）", volume: 80 },
  dance_jingle: { label: "ダンスのジングル", volume: 80 },
  star_jingle: { label: "きらめきのジングル", volume: 80 },
  summon_magic: { label: "召喚の魔法", volume: 80 },
  deer_call: { label: "シカの鳴き声", volume: 80 },
  chime: { label: "きらきら", volume: 80 },
} as const satisfies Record<string, { label: string; volume: number }>;

export type ClearedSoundId = keyof typeof CLEARED_SOUNDS;
export const CLEARED_SOUND_IDS = Object.keys(CLEARED_SOUNDS) as ClearedSoundId[];

export function clearedSoundUrl(id: ClearedSoundId): string {
  return `/se/defaults/cc0/${id}.mp3`;
}

export function clearedSoundLabel(id: ClearedSoundId): string {
  return `${CLEARED_SOUNDS[id].label}（CC0）`;
}

/** 中身が名前から分からないファイル（同期元の実ファイル名。拡張子なし・小文字） */
const EXACT_LABELS: Readonly<Record<string, ClearedSoundId>> = {
  harakiridrive: "dance_jingle",
  x3_vol5: "pig_oink",
  "d584ae8d-2137-4660-b356-9e55f22e2fb5": "deer_call",
};

/** ファイル名に含まれる語 → CC0 の同種の音（上から順に最初に当たったもの） */
const LABEL_RULES: ReadonlyArray<readonly [RegExp, ClearedSoundId]> = [
  [/ドラムロール|drum ?roll/i, "drumroll"],
  [/ポキューン|先バレ|激熱|jackpot|ジャックポット/i, "jackpot_alert"],
  [/gako|ガコ|ジャグラー|juggler/i, "slot_clunk"],
  [/シャキーン|shing|unsheath/i, "sparkle_shing"],
  [/エアー?ホーン|air ?horn/i, "air_horn"],
  [/花火|firework/i, "fireworks"],
  [/ゾウ|ぞう|象|elephant/i, "elephant"],
  [/犬|いぬ|イヌ|吠え|(^|[^a-z])(dog|bark|puppy)/i, "dog_bark"],
  [/豚|ぶた|ブタ|buta|oink|(^|[^a-z])pig/i, "pig_oink"],
  [/猫|ねこ|ネコ|にゃ|ニャ|nya|meow|kitten|(^|[^a-z])cat([^a-z]|$)/i, "cat_meow"],
  [/ネズミ|ねずみ|鼠|mouse|squeak/i, "mouse_squeak"],
  [/ウグイス|うぐいす|鶯|さえずり|warbler|songbird/i, "bird_song"],
  [/ヒヨドリ|ひよどり|小鳥|chirp|tweet|(^|[^a-z])bird/i, "bird_chirp"],
  [/鹿|シカ|(^|[^a-z])deer/i, "deer_call"],
  [/出でよ|しもべ|召喚|魔法|summon|magic|spell/i, "summon_magic"],
  // 「レジスター」「マスター」の中の「スター」は当てない（カタカナ語の途中は除く）
  [/(?<![ァ-ヶー])スター|(^|[^a-z])star|きらめき/i, "star_jingle"],
  [/ダンス|(^|[^a-z])(dance|disco)/i, "dance_jingle"],
  [/きらきら|キラキラ|sparkle|twinkle/i, "chime"],
];

/** 同期元のファイル名（label）から、配ってよい CC0 の同種の音を決める。決まらなければ null（配らない） */
export function clearedSoundFor(label: string | null | undefined): ClearedSoundId | null {
  if (!label) return null;
  const base = label.trim().replace(/\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i, "");
  const exact = EXACT_LABELS[base.toLowerCase()];
  if (exact) return exact;
  for (const [re, id] of LABEL_RULES) if (re.test(base)) return id;
  return null;
}

export interface SourceRow {
  key: string;
  url: string | null;
  volume: number;
  enabled: boolean;
  label: string | null;
}

/** 配ってよい key（アイテム・パターン・まとめ投げ・カテゴリ）。価格帯 tier:* は自動ライブラリに任せるので配らない */
const DISTRIBUTABLE_KEY_RE = /^(pattern:\d{1,10}|item:\d{1,10}|cat:kind:(normal|hit|anim)|cat:group:[A-Za-z0-9_#-]{1,64}|bulk:(item:\d{1,10}:)?(COOL|GREAT|FANTASTIC|MIRACLE))(#[2-5])?$/;

/**
 * 同期元の行を「他の利用者に配ってよい公式既定」にする。
 * 音源は必ず同梱の CC0 の音（/se/defaults/cc0/）に置き換え、置き換え先が無い行・価格帯・鳴らす OFF・音源なしの行は落とす。
 */
export function toClearedDefaultRows<T extends SourceRow>(rows: readonly T[]): T[] {
  const out: T[] = [];
  for (const r of rows) {
    if (!r.enabled || !r.url || !DISTRIBUTABLE_KEY_RE.test(r.key)) continue;
    const id = clearedSoundFor(r.label);
    if (!id) continue;
    out.push({ ...r, url: clearedSoundUrl(id), label: clearedSoundLabel(id), volume: CLEARED_SOUNDS[id].volume });
  }
  return out;
}
