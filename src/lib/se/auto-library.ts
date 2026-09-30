// 自動ライブラリ（2026-09-29 社長指示「まだ音源が入っていないアイテムに似合う SE を自動で。主要アイテムは 5 種類をランダムで」）。
//
// 仕組み:
//   - 音源は public/se/lib/<セット>/v7-1..5.mp3 に同梱。すべて CC0 1.0 の素材（Freesound の CC0 フィルタ / Kenney の効果音パック）だけで作る
//     （2026-09-30 正式リリース・社長指示「著作権のあるものは弾いて別の音源に差し替えて」・S23。v6 まで使っていた Mixkit・魔王魂・
//     ニコニ・コモンズの素材は、アプリでの再配布や利用範囲の条件を満たせないので使わない）。
//     有料アイテム: scripts/se/build_se_cc0.py mix（素材は scripts/se/cc0_picks.py）が ライザー → インパクト → テーマ音の連打 → 確定音 → ファンファーレ／歓声
//     ＋ コイン ＋ きらきら の順に ffmpeg で重ね（-14 LUFS・リミッター・mono 96k）、派手さ（LEVEL 1〜4）で 3〜15 秒にする。
//     無料アイテム（tier-T0・lite-hit・lite-{テーマ}）は素材 1 つの単発音（1.5 秒まで・-19 LUFS）。テーマはアイテム名の最後の言葉（freeThemeFor）。
//     各ファイルの素材と出典は public/se/lib/manifest.json の components、SE タブの出典一覧は AUTO_LIBRARY_CREDITS
//   - アイテム名（とカテゴリ key）のキーワードからテーマを決める（themeForItem）。1 テーマ最大 5 本からランダムに 1 本
//     （直前と同じ音は避ける）
//   - まとめ投げの段階（COOL/GREAT/FANTASTIC/MIRACLE）・当たり・価格帯の既定にもセットがある
//   - 単価 ¥160 以上（PREMIUM_MIN_YEN）は 5 秒以上のミックスにする（2026-09-30 社長指示「160円以上のアイテムの SE をもっと 5 秒以上で組み合わせて豪華に」・S25）:
//     テーマのミックスが 5 秒未満のテーマ（風船・食べ物・ポップ等）は豪華版 p-{テーマ}、価格帯の既定は T2 以上
//   - 主要なイベントアイテム（応援の動物・たぬっち）と花火は、まとめ投げの段階ごとに専用の長いミックス ev-{テーマ}-{段階}（EVENT_BULK_THEMES）
//   - 優先順は choose-sound.ts。ユーザーが個別に割り当てた行（bulk:item / pattern / bulk / item）はこのライブラリより優先し、
//     カテゴリ一括・価格帯の既定より前にこのライブラリを当てる（「そのアイテムらしい音」を優先するため）
//
// サービスワーカーの事前キャッシュからは除外している（next.config.ts）。音源は鳴らす直前に取得し、engine.ts の LRU に載る。

import { AUTO_LIBRARY, type AutoLibraryFile } from "./auto-library-data";
import type { BulkGrade } from "./bulk-grade";
import type { SeTier } from "./tiers";

export type { AutoLibraryFile };

/** テーマの日本語名（SE タブ・ログ用） */
export const THEME_LABELS: Record<string, string> = {
  fireworks: "花火",
  fanfare: "ファンファーレ",
  win: "勝利・達成",
  jackpot: "ジャックポット",
  coin: "コイン",
  cheer: "歓声・拍手",
  sparkle: "きらきら",
  magic: "魔法",
  heart: "ハート・ラブ",
  balloon: "風船",
  cat: "ねこ",
  dog: "いぬ",
  pig: "ぶた",
  elephant: "ゾウ",
  wolf: "オオカミ",
  lion: "ライオン",
  bird: "とり・ひよこ",
  horse: "うま",
  cow: "うし",
  monkey: "さる",
  bear: "くま",
  cute: "かわいい・ポップ",
  tanuki: "たぬき（ぽんぽこ）",
  mole: "もぐら",
  deer: "シカ",
  aurora: "オーロラ・銀河",
  drink: "乾杯・ドリンク",
  food: "食べ物",
  party: "パーティー",
  bell: "ベル・チャイム",
  christmas: "クリスマス",
  halloween: "ハロウィン",
  sea: "海・水",
  rocket: "ロケット・宇宙",
  explosion: "爆発",
  casino: "カジノ・ゲーム",
  music: "音楽",
  battle: "バトル",
  vehicle: "乗り物",
  flower: "花・自然",
  pop: "ポップ",
  trophy: "トロフィー・王者",
  epic: "壮大",
  notify: "通知音",
  wow: "歓喜",
  dice: "サイコロ",
  kids: "こども",
  thunder: "雷",
  fire: "炎",
  laser: "レーザー・電撃",
  whoosh: "風切り",
};

/**
 * アイテム名 → テーマ。上から順に最初に当たったものを使う（固有名詞ほど上に置く）。
 * 「ふわっち」「(復刻)」等は除いてから判定する
 */
const NAME_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ["fireworks", /花火|たまや|かぎや|ふわや|スターマイン|ナイアガラ/],
  ["wolf", /オオカミ|おおかみ|狼|ウルフ|赤ずきん/],
  ["jackpot", /ジャックポット|大当|万馬券|石油王|スロット|777/],
  ["dice", /サイコロ|ダイス/],
  ["casino", /くじ|ガラガラ|ルーレット|カジノ|チャンス|突入|ボーナス|倍率|カード/],
  ["trophy", /王冠|トロフィー|メダル|殿堂|伝説|キング|クイーン|王様|女王|チャンピオン|最強|覇者|優勝/],
  ["drink", /ワイン|シャンパン|KP|乾杯|ビール|ドリンク|ジュース|ソーダ|お茶|コーヒー|カクテル|ヌーヴォー|酒/],
  ["cat", /ねこ|ネコ|猫|にゃ|キャット/],
  ["dog", /ワン|犬|いぬ|イヌ|ドッグ|わんこ|パピー/],
  ["pig", /ぶた|ブタ|豚|ピッグ/],
  ["elephant", /ゾウ|ぞう|象/],
  ["bear", /くま|クマ|熊|ベア/],
  ["lion", /ライオン|トラ|虎|タイガー|ヒョウ/],
  ["monkey", /さる|サル|猿|モンキー/],
  ["horse", /うま|ウマ|馬|ポニー|ユニコーン|ペガサス/],
  ["cow", /うし|ウシ|牛/],
  ["bird", /ひよこ|にわとり|ニワトリ|鳥|とり|ペンギン|ふくろう|フクロウ|インコ|バード|ツバメ|カモ|うぐいす|ひばり/],
  // 2026-09-30 S25: 主要なイベントアイテム（おばあさんたぬっち・もぐりながら応援するもぐらさん・たしかな応援をするシカさん）の専用テーマ。
  // 「たしかな」の「しか」に当てないよう、シカはカタカナと漢字だけ
  ["tanuki", /たぬ|タヌキ|狸/],
  ["mole", /もぐら|モグラ|土竜/],
  ["deer", /シカ|鹿/],
  ["cute", /うさぎ|ウサギ|兎|ネズミ|ねずみ|ハムスター|パンダ|コアラ|カピバラ|アニマル|ぬいぐるみ/],
  ["balloon", /風船|バルーン/],
  ["sea", /釣り|魚|さかな|マグロ|サメ|イルカ|クジラ|マンボウ|シイラ|カジキ|海|ビーチ|マリン|クルーザー|クルーズ|スプラッシュ|水族館|アクアリウム|スイカ割り|波|ヨット|船旅/],
  ["cheer", /メガホン|応援団|応援|うちわ|拍手|手拍子|エール|声援|いいね|ペンライト|アイドル|ライブ/],
  ["heart", /ハート|本命|友チョコ|バレンタイン|ホワイトデー|キス|ラブ|恋|デート|結婚|ウェディング|プロポーズ|指輪/],
  ["coin", /金貨|コイン|貯金箱|キャッシュ|お金|札束|小判|ゴールド|金の|金運|ダイヤ|宝石|ジュエリー|ネックレス|宝箱|宝/],
  // 2026-09-30 社長指示「ギンギラギンギャラクシーオーロラの音が悲しい」: オーロラ・銀河は専用テーマ（明るく上がるきらめきだけ）
  ["aurora", /ギャラクシー|オーロラ|天の川|銀河|星空/],
  ["sparkle", /銀|シルバー|スター|星|キラ|流星|プラチナ|ギンギラギン|イルミネーション|スノードーム/],
  ["magic", /魔法|マジカル|マジック|プリンセス|ドリーム|妖精|フェアリー|ミラー|ふしぎ|不思議|召喚|エルフ/],
  ["rocket", /ロケット|UFO|宇宙|隕石|ジェット|ロボ|サイボーグ|宇宙旅行|惑星|流星群/],
  ["explosion", /爆|爆破|爆発|大砲|ダイナマイト|ボム|噴火|火山/],
  ["thunder", /雷|サンダー|稲妻|嵐/],
  ["fire", /炎|ファイヤー|ファイア|焚き火|キャンドル|ろうそく|松明/],
  ["battle", /剣|ソード|海賊|ヒーロー|出撃|バトル|攻撃|必殺|忍者|侍|サムライ|戦士|ガンダム|ファイター|拳/],
  ["christmas", /クリスマス|サンタ|トナカイ|雪|スノー|冬|こたつ|ジングル/],
  ["halloween", /ハロウィン|かぼちゃ|おばけ|オバケ|幽霊|ゾンビ|ジャック|魔女|ドラキュラ/],
  ["party", /クラッカー|パーティ|バースデー|誕生|お祝い|祝|周年|アニバーサリー|記念|カーニバル|フェス|祭|神輿|Festival/],
  ["music", /音符|マイク|歌|ダンス|DJ|ラジオ|ピアノ|ギター|太鼓|音楽|ミュージック|オーケストラ|楽器|リクエスト|オトノバ/],
  ["food", /ケーキ|パン|バーガー|ドーナツ|アイス|パフェ|クレープ|オムライス|カレー|スイーツ|チョコ|団子|さくらんぼ|いちご|スイカ|柿|ポテト|えだまめ|クッキー|ピザ|寿司|ラーメン|たこ焼き|焼き|肉|フルーツ|バナナ|りんご|メロン|ぶどう|パンケーキ|プリン|タルト|ベーカリー|グルメ|飯|弁当|おにぎり|カフェ|バーベキュー|クッキング/],
  ["flower", /花|バラ|ローズ|ブーケ|花束|リース|どんぐり|紅葉|葉|桜|さくら|チューリップ|ひまわり|コスモス|梅|藤|あじさい|紫陽花|クローバー|オータム|春|秋|森|ガーデン|木/],
  ["vehicle", /トラック|車|バイク|電車|新幹線|飛行機|バス(?!ケット)|タクシー|パトカー|救急車|消防車/],
  ["kids", /こども|子ども|赤ちゃん|ベビー|おもちゃ|トイ|園児|ランドセル/],
  ["laser", /レーザー|ビーム|電撃|サイバー|ネオン|エレクトリック|ハイテク/],
  ["epic", /ウルトラ|ペタ|テラ|ギガ|メガ|超|究極|デラックス|スペシャル|プレミアム|ゴージャス|豪華|最高級|パック/],
  ["pop", /初見です|はい！|おつかれ|チラッ|うんうん|それな|お邪魔します|おはよう|おやすみ|イケメン|まじ|天才|最高|草|神|え？|かわいい|ひとこと|ありがとう|了解|おめでとう|ナイス|ｗ|笑/],
];

/** カテゴリ key（whowatch_item_groups.group_key）からのテーマ。名前で決まらないときの補助 */
const GROUP_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ["fireworks", /fireworks|hanabi/],
  ["sea", /fishing/],
  ["sparkle", /gingiragin/],
  ["music", /music/],
  ["dice", /dice/],
  ["party", /birthday|anniversary/],
  ["pop", /^word$/],
  ["explosion", /explosion/],
  ["battle", /attack|battle|hero/],
  ["cat", /neko/],
  ["wolf", /wolf/],
  ["cheer", /rookie|toryumon|ranking/],
];

/** テーマ判定の前に名前から除く装飾語 */
const STRIP_RE = /ふわっち|\(復刻\)|（復刻）|\(Web\)|（Web）|\(Ｓ\)|\(Ｍ\)|\(Ｌ\)|9月も|月も|シルバー版|の当たり|のあたり|×\s*\d+|\s+/g;

export function themeForItem(itemName: string | null | undefined, groups: readonly string[] | null | undefined = null): string | null {
  const name = (itemName ?? "").replace(STRIP_RE, "");
  if (name) {
    for (const [theme, re] of NAME_RULES) if (re.test(name)) return theme;
  }
  for (const g of groups ?? []) {
    for (const [theme, re] of GROUP_RULES) if (re.test(g)) return theme;
  }
  return null;
}

/** 直前に鳴らしたファイル（セット名 → url）。同じセットで同じ音が続かないようにする */
const lastPlayed = new Map<string, string>();

export function pickVariant<T extends { file: string }>(setName: string, files: readonly T[], rand: () => number = Math.random): T | null {
  if (files.length === 0) return null;
  if (files.length === 1) {
    lastPlayed.set(setName, files[0].file);
    return files[0];
  }
  const last = lastPlayed.get(setName);
  const pool = files.filter((f) => f.file !== last);
  const chosen = pool[Math.floor(rand() * pool.length)] ?? files[0];
  lastPlayed.set(setName, chosen.file);
  return chosen;
}

export function libraryFiles(setName: string): readonly AutoLibraryFile[] {
  return AUTO_LIBRARY[setName] ?? [];
}

export function hasLibrarySet(setName: string): boolean {
  return (AUTO_LIBRARY[setName]?.length ?? 0) > 0;
}

export interface AutoTarget {
  itemName: string | null;
  groups?: readonly string[] | null;
  tier: SeTier;
  isHit: boolean;
  bulkGrade?: BulkGrade | null;
  /** 無料アイテム（単価 0・不明）。控えめな音（lite-*）にする（2026-09-30 社長指示「無料が派手すぎる」） */
  free?: boolean;
  /** 単価 ¥160 以上（isPremiumPrice）。5 秒以上のミックスにする（S25） */
  premium?: boolean;
}

export interface AutoChoice {
  set: string;
  theme: string | null;
  file: AutoLibraryFile;
}

/** まとめ投げの段階 → セット名。段階の変種（TAMAYA 等）は FANTASTIC 相当にする */
export function bulkSetName(grade: BulkGrade): string {
  return `bulk-${mainGrade(grade)}`;
}

/** 段階の変種（TAMAYA 等）は FANTASTIC 相当 */
function mainGrade(grade: BulkGrade): "COOL" | "GREAT" | "FANTASTIC" | "MIRACLE" {
  return grade === "COOL" || grade === "GREAT" || grade === "FANTASTIC" || grade === "MIRACLE" ? grade : "FANTASTIC";
}

/** 豪華版の下限（2026-09-30 社長指示「160円以上のアイテムの SE をもっと 5 秒以上で組み合わせて豪華に」・S25） */
export const PREMIUM_MIN_YEN = 160;

/** 単価（1 個あたり・円）が豪華版の対象か。無料・不明は対象外 */
export function isPremiumPrice(unitPriceYen: number | null | undefined): boolean {
  return typeof unitPriceYen === "number" && unitPriceYen >= PREMIUM_MIN_YEN;
}

/**
 * まとめ投げの段階ごとに専用の長いミックスがあるテーマ（S25: 社長指示「主要なイベントアイテムはまとめ投げごとにさらに長い豪華な音に」
 * 「花火系ももっと花火らしい綺羅びやかな長い SE に」）。セット名は ev-{テーマ}-{段階}。COOL 約 9 秒 → MIRACLE 約 20 秒
 */
export const EVENT_BULK_THEMES = ["tanuki", "pig", "elephant", "deer", "dog", "mole", "fireworks"] as const;

/** まとめ投げの段階のセット（有料）。専用セットがあるテーマ（EVENT_BULK_THEMES）はそちら、無ければ共通の bulk-{段階} */
export function bulkSetFor(grade: BulkGrade, theme: string | null): string {
  const g = mainGrade(grade);
  if (theme && (EVENT_BULK_THEMES as readonly string[]).includes(theme) && hasLibrarySet(`ev-${theme}-${g}`)) return `ev-${theme}-${g}`;
  return `bulk-${g}`;
}

/** テーマのミックス（有料）。豪華版の対象で p-{テーマ}（5 秒以上）があればそちら */
export function themeSetFor(theme: string, premium: boolean): string {
  return premium && hasLibrarySet(`p-${theme}`) ? `p-${theme}` : theme;
}

/** 価格帯の既定のセット。豪華版の対象は T0・T1（5 秒未満）を T2 にする */
export function tierSetFor(tier: SeTier, premium = false): string {
  if (tier === "hit") return "hit";
  if (premium && (tier === "T0" || tier === "T1")) return "tier-T2";
  return `tier-${tier}`;
}

/**
 * 無料アイテムのテーマ（2026-09-30 社長指示「無料が控え目すぎるのでもうすこしテーマに合わせてほしい」）。
 * アイテム名の **最後に出てくる言葉**（日本語の複合語の中心になる名詞）でテーマを決める: 赤ずきんサイコロ → サイコロ、
 * ふわっち11周年記念花火 → 花火（「花」より「花火」が後ろまで続く）、イベント応援するゾウ！ → ゾウ、石油王スロット → スロット。
 * 同じ位置で終わるときは NAME_RULES の順。名前で決まらなければカテゴリ key（GROUP_RULES）から補う（バスケット → wolfcoming → オオカミ）。
 * 無料の音はどのテーマも「そのテーマらしい単発の音」（lite-{テーマ}・素材 1 つ・1.5 秒まで・-19 LUFS。scratchpad build_se_theme_lite.py）なので、
 * 派手なテーマを別のテーマに置き換えることはしない（v5 で置き換えたら控えめすぎた）
 */
export function freeThemeFor(itemName: string | null | undefined, groups: readonly string[] | null | undefined = null): string | null {
  const name = (itemName ?? "").replace(STRIP_RE, "");
  let best: { theme: string; end: number } | null = null;
  if (name) {
    for (const [theme, re] of NAME_RULES) {
      const g = new RegExp(re.source, "g");
      let m: RegExpExecArray | null;
      let end = -1;
      while ((m = g.exec(name)) !== null) {
        end = Math.max(end, m.index + m[0].length);
        if (m[0].length === 0) g.lastIndex++;
      }
      if (end > (best?.end ?? -1)) best = { theme, end };
    }
  }
  if (best) return best.theme;
  for (const g of groups ?? []) {
    for (const [theme, re] of GROUP_RULES) if (re.test(g)) return theme;
  }
  return null;
}

/** 無料アイテムの音量（自動ライブラリの有料は 80）。v5 の 55 は控えめすぎたので 65（2026-09-30） */
export const FREE_AUTO_VOLUME = 65;

/**
 * 無料アイテムの音のセット（2026-09-30 社長指示「無料が派手すぎる」→「控え目すぎるのでもうすこしテーマに合わせて」）。
 * ミックスではなく素材 1 つの単発音。当たり → lite-hit / テーマ（freeThemeFor）→ lite-{テーマ}。
 * どちらも無ければ null（カテゴリの既定 → 価格帯の既定 tier-T0 のポップ音）
 */
export function liteSetFor(itemName: string | null | undefined, groups: readonly string[] | null | undefined, isHit: boolean): string | null {
  if (isHit && hasLibrarySet("lite-hit")) return "lite-hit";
  const theme = freeThemeFor(itemName, groups);
  if (!theme) return null;
  if (hasLibrarySet(`lite-${theme}`)) return `lite-${theme}`;
  // S25 で足したテーマ（たぬき・もぐら・シカ・オーロラ）は無料の単発音を持たないので、それまでと同じ単発音（かわいい・きらきら）
  const fallback = LITE_FALLBACK[theme];
  return fallback && hasLibrarySet(`lite-${fallback}`) ? `lite-${fallback}` : null;
}

const LITE_FALLBACK: Readonly<Record<string, string>> = { tanuki: "cute", mole: "cute", deer: "cute", aurora: "sparkle" };

/**
 * 「そのアイテムらしい音」を選ぶ（ユーザーの個別割り当てが無いときに使う）。
 * 段階付き → bulk-{段階} / 当たり → hit / テーマあり → テーマ。無ければ null（カテゴリ・価格帯の既定に落とす）。
 * 無料アイテムは段階・当たり・テーマのミックスを使わず、控えめな音（liteSetFor）にする
 */
export function chooseAutoForItem(t: AutoTarget, rand: () => number = Math.random): AutoChoice | null {
  if (t.free) {
    const set = liteSetFor(t.itemName, t.groups, t.isHit);
    if (!set) return null;
    const f = pickVariant(set, libraryFiles(set), rand);
    return f ? { set, theme: set === "lite-hit" ? null : set.slice(5), file: f } : null;
  }
  const theme = themeForItem(t.itemName, t.groups);
  if (t.bulkGrade) {
    const set = bulkSetFor(t.bulkGrade, theme);
    const f = pickVariant(set, libraryFiles(set), rand);
    if (f) return { set, theme: set.startsWith("ev-") ? theme : null, file: f };
  }
  if (t.isHit && hasLibrarySet("hit")) {
    const f = pickVariant("hit", libraryFiles("hit"), rand);
    if (f) return { set: "hit", theme: null, file: f };
  }
  if (theme && hasLibrarySet(theme)) {
    const set = themeSetFor(theme, t.premium === true);
    const f = pickVariant(set, libraryFiles(set), rand);
    if (f) return { set, theme, file: f };
  }
  return null;
}

/** 価格帯の既定（ユーザー・公式既定のどちらにも tier 行が無いとき）。premium（単価 ¥160 以上）は 5 秒以上のセット */
export function chooseAutoForTier(tier: SeTier, rand: () => number = Math.random, premium = false): AutoChoice | null {
  const set = tierSetFor(tier, premium);
  const f = pickVariant(set, libraryFiles(set), rand);
  return f ? { set, theme: null, file: f } : null;
}

/**
 * 起動時に先読みしておくセット（価格帯・段階・当たり）。1 セット 2 本まで（v3 のミックスは 1 本 最大 15 秒 mono で
 * デコード後 約 2.9MB。10 セット × 2 本 ≒ 60MB が上限）。残りとテーマの音は鳴らす直前に取る（engine.ts の LRU に載る）
 */
export function coreLibraryUrls(perSet = 2): string[] {
  const sets = ["tier-T0", "tier-T1", "tier-T2", "tier-T3", "tier-T4", "hit", "bulk-COOL", "bulk-GREAT", "bulk-FANTASTIC", "bulk-MIRACLE"];
  return sets.flatMap((s) => libraryFiles(s).slice(0, perSet).map((f) => f.file));
}
