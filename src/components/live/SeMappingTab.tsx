"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { playSe, unlockAudio } from "@/lib/se/engine";
import { itemKind, ITEM_KIND_LABELS, patternKind, type ItemKind } from "@/lib/se/item-kind";
import { tierForGift, TIER_LABELS, type SeTier } from "@/lib/se/tiers";
import { expandablePatternRows } from "@/lib/se/pattern-rows";
import { WEB_BONUS_GROUP, WEB_BONUS_LABEL, isWebBonusItem } from "@/lib/se/web-bonus";
import { VolumeSlider } from "./VolumeSlider";
import { SePresetPanel } from "./SePresetPanel";
import { useLiveConnection } from "./LiveConnectionProvider";
import { mergeWithDefaults, type MergedMapping } from "@/lib/se/merge-defaults";

// S1: SE タブ。アイテムマスタ（/playitems × payments3 の価格）を一覧し、アイテム／パターンごとに SE を割り当てる。
// 音源は Supabase Storage バケット "se"（mp3/ogg/wav・5MB 以下・パス {user_id}/…）。未設定は既定合成音。
//
// 決裁(2026-09-25) 案P: アイテム欄はふわっちのアイテムページと同じ「カテゴリごとのバナー見出し＋アイテム」の並び。
//   - 見出しはバナー画像（payments3 に URL があれば）か、無ければ文字のカード。見出しの中でカテゴリ一括 SE を割り当てる
//   - 「分類なし」（無料・販売終了・その他）はプルダウンで選んだときだけ表示する
// 決裁(2026-09-25) 案Y: 無料アイテムは価格帯の既定「無料アイテム（ポップ）」に従う（カテゴリは新設しない）

interface PatternRow {
  patternId: number;
  patternName: string;
  isHit: boolean;
  hitGrade: string | null;
  isVariant: boolean;
  animationUrl: string | null;
  animationFullscreen: boolean;
}
interface ItemRow {
  itemId: number;
  itemName: string;
  priceJpy: number | null;
  onSale: boolean;
  /** アイテムの代表画像（/playitems の image_url から 1 枚。無ければ null） */
  imageUrl?: string | null;
  /** 属するカテゴリ（アイテムページの並び順） */
  groups: string[];
  patterns: PatternRow[];
}
/** アイテムページの見出し（/playitems/payments3 のカテゴリ） */
interface GroupRow {
  groupKey: string;
  groupTitle: string;
  subGroupTitle: string | null;
  badgeText: string | null;
  displayOrder: number | null;
  /** バナー画像 URL（0017）。無ければ文字の見出し */
  bannerUrl?: string | null;
  description?: string | null;
  itemCount: number;
}
/** プルダウンの「分類なし」を表す擬似カテゴリのキー */
const NONE_GROUP = "none";
/** 検索中に全アイテムをまとめて出す擬似カテゴリのキー */
const SEARCH_GROUP = "search";
/** 擬似カテゴリ（ふわっちのアイテムページの見出しではない）: カテゴリ一括の cat:group: は使えない */
const PSEUDO_GROUPS = new Set<string>([NONE_GROUP, SEARCH_GROUP, WEB_BONUS_GROUP]);
/** 仮想リストの 1 行: カテゴリ見出し か アイテムの段（最大 GRID_COLUMNS 件をグリッドで並べる） */
type ListRow = { kind: "header"; group: GroupRow; count: number } | { kind: "items"; items: ItemRow[]; groupKey: string };
/** アイテムページと同じ 3 列（画面幅が狭ければ CSS 側で 2 列・1 列に落ちる） */
const GRID_COLUMNS = 3;
function chunkItems(items: ItemRow[], groupKey: string): ListRow[] {
  const out: ListRow[] = [];
  for (let i = 0; i < items.length; i += GRID_COLUMNS) out.push({ kind: "items", items: items.slice(i, i + GRID_COLUMNS), groupKey });
  return out;
}
interface Mapping {
  key: string;
  url: string | null;
  volume: number;
  enabled: boolean;
  label: string | null;
}

/** 2026-09-26: 5MB → 20MB、m4a / aac 追加（サーバ /api/se/upload と drizzle/0019 に合わせる） */
const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPT = "audio/mpeg,audio/mp3,audio/ogg,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/x-m4a,.mp3,.ogg,.wav,.m4a,.aac";
const EXT_RE = /\.(mp3|ogg|wav|m4a|aac)$/i;
const describeFile = (f: File) => `${f.name}（${(f.size / 1024 / 1024).toFixed(1)}MB${f.type ? ` · ${f.type}` : ""}）`;
const TIERS: SeTier[] = ["T0", "T1", "T2", "T3", "T4", "hit"];
const KINDS: ItemKind[] = ["normal", "hit", "anim"];
/** 種類ごとの一括割り当てを試聴するときの既定ティア */
const KIND_PREVIEW_TIER: Record<ItemKind, SeTier> = { normal: "T2", hit: "hit", anim: "T3" };

/**
 * 2026-09-26 修正: 音源のアップロードが「何も起きない」問題。
 * 原因は 2 つの組み合わせ。(1) SeMappingTab が useLiveConnection() で提供者の値を購読していたため、接続中のポーリングや
 * 監視（数秒ごと）のたびに再描画されていた。(2) MappingControls がコンポーネント内で定義されていたため、親が再描画される
 * たびに別のコンポーネントとして作り直され、<input type="file"> ごと外れて付け直されていた。ファイル選択ダイアログを
 * 開いている数秒の間に再描画が起きると、ダイアログを開いた input は既に外れており、選択後の change が届かない。
 * 対策: context を読むのはこの薄いラッパーだけにし（reloadMappings は安定した参照）、本体は memo で包む。
 * MappingControls はモジュール直下の memo コンポーネントにして、再描画されても同じ要素を使い続ける
 */
export function SeMappingTab() {
  const { reloadMappings } = useLiveConnection();
  return <SeMappingTabInner reloadMappings={reloadMappings} />;
}

const SeMappingTabInner = memo(function SeMappingTabInner({ reloadMappings }: { reloadMappings: () => Promise<void> }) {
  const [items, setItems] = useState<ItemRow[] | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  // 自分の se_mappings。表示・試聴には公式の既定 SE（同梱）を合成した mappings を使う
  const [userRows, setUserRows] = useState<Mapping[]>([]);
  /** 公式既定（同期元＝社長の現在の割り当て）。null なら同梱スナップショット */
  const [liveDefaults, setLiveDefaults] = useState<Mapping[] | null>(null);
  const [defaultsSource, setDefaultsSource] = useState<"sync" | "bundled">("bundled");
  const mappings = useMemo<MergedMapping[]>(() => mergeWithDefaults(userRows, liveDefaults), [userRows, liveDefaults]);
  const [filter, setFilter] = useState("");
  const [onlyOnSale, setOnlyOnSale] = useState(true);
  const [kindFilter, setKindFilter] = useState<ItemKind | "all">("all");
  const [groups, setGroups] = useState<GroupRow[]>([]);
  /** "all" = すべて / "none" = 分類なし（販売終了・その他） / それ以外は group_key */
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // 2026-09-26: メッセージは一覧の上にしか出ておらず、価格帯・種類の行でアップロードに失敗しても気付けなかった。操作した行の直下にも出す
  const [msgKey, setMsgKey] = useState<string | null>(null);
  const say = (key: string | null, text: string | null) => {
    setMsg(text);
    setMsgKey(text ? key : null);
  };

  useEffect(() => {
    fetch("/api/platforms/whowatch/items/patterns")
      .then((r) => (r.ok ? (r.json() as Promise<{ items?: ItemRow[]; groups?: GroupRow[]; syncedAt?: string | null }>) : { items: [] }))
      .then((d: { items?: ItemRow[]; groups?: GroupRow[]; syncedAt?: string | null }) => {
        setItems(d.items ?? []);
        setGroups(d.groups ?? []);
        setSyncedAt(d.syncedAt ?? null);
      })
      .catch(() => setItems([]));
    fetch("/api/se/mappings")
      .then((r) => (r.ok ? (r.json() as Promise<{ mappings?: Mapping[]; defaults?: Mapping[] | null; defaultsSource?: "sync" | "bundled" }>) : { mappings: [], defaults: null }))
      .then((d: { mappings?: Mapping[]; defaults?: Mapping[] | null; defaultsSource?: "sync" | "bundled" }) => {
        setUserRows(d.mappings ?? []);
        setLiveDefaults(d.defaults ?? null);
        setDefaultsSource(d.defaultsSource ?? "bundled");
      })
      .catch(() => undefined);
  }, []);

  const byKey = useMemo(() => new Map(mappings.map((m) => [m.key, m])), [mappings]);
  /** その key に自分の行（上書き）があるか。既定 SE だけの key は「上書き中」にしない */
  const isUser = (key: string) => byKey.get(key)?.source === "user";
  const listRef = useRef<HTMLDivElement>(null);

  /** プリセット取り込み後: この画面と再生側（LiveConnectionProvider）の両方を再読込する */
  const reloadAll = async () => {
    try {
      const r = await fetch("/api/se/mappings");
      const d = r.ok
        ? ((await r.json()) as { mappings?: Mapping[]; defaults?: Mapping[] | null; defaultsSource?: "sync" | "bundled" })
        : { mappings: [], defaults: null };
      setUserRows(d.mappings ?? []);
      setLiveDefaults(d.defaults ?? null);
      setDefaultsSource(d.defaultsSource ?? "bundled");
    } catch {
      // 取得できなければ今の表示のまま
    }
    await reloadMappings();
  };

  const query = filter.trim();
  /**
   * 検索・価格・種類で絞ったアイテム（カテゴリはまだ見ていない）。検索中は「価格ありのみ」を無視して全アイテムから探す（2026-09-26: WEBおまけ等が見つからなかった対策）。
   * イベントのカテゴリに属する無料配布アイテム（オータムリース・バスケット等。0021 で分類）は「価格ありのみ」でも隠さない
   * （2026-09-26 社長報告「無料アイテムが反映されていない」の原因がこの絞り込みだった）
   */
  const filtered = useMemo(() => {
    const q = query;
    return (items ?? [])
      .filter((i) => (!onlyOnSale || q !== "" || i.priceJpy !== null || (i.groups?.length ?? 0) > 0) && (!q || i.itemName.includes(q) || i.patterns.some((p) => p.patternName.includes(q))))
      .filter((i) => kindFilter === "all" || itemKind(i.patterns) === kindFilter);
  }, [items, query, onlyOnSale, kindFilter]);

  /** 分類なし（どのカテゴリにも属さない）のアイテム。プルダウンで選んだときだけ表示する */
  const unclassified = useMemo(() => filtered.filter((i) => (i.groups?.length ?? 0) === 0), [filtered]);
  /** WEBおまけ・無料アイテム（ネズミ・メガホン・ハートなど）。価格の有無の絞り込みは無視して名前で束ねる */
  const webBonus = useMemo(
    () =>
      (items ?? [])
        .filter((i) => isWebBonusItem(i) && (!query || i.itemName.includes(query) || i.patterns.some((p) => p.patternName.includes(query))))
        .filter((i) => kindFilter === "all" || itemKind(i.patterns) === kindFilter)
        .sort((a, b) => a.itemName.localeCompare(b.itemName, "ja")),
    [items, query, kindFilter],
  );
  const webBonusKeys = useMemo(() => webBonus.map((i) => `item:${i.itemId}`), [webBonus]);

  /**
   * 表示する行。カテゴリごとに「見出し → そのカテゴリのアイテム」を並べる（ふわっちのアイテムページと同じ順）。
   * 1 アイテムが複数カテゴリに属する場合はそれぞれのカテゴリに出す（アイテムページも同じ）
   */
  const rows = useMemo<ListRow[]>(() => {
    const out: ListRow[] = [];
    if (query !== "") {
      // 検索中はカテゴリ・価格の有無を問わず全アイテムから 1 つの一覧にする
      out.push({ kind: "header", group: { groupKey: SEARCH_GROUP, groupTitle: `検索結果「${query}」`, subGroupTitle: null, badgeText: null, displayOrder: null, description: "全アイテムから名前で検索しています（価格の有無・カテゴリを問いません）", itemCount: filtered.length }, count: filtered.length });
      out.push(...chunkItems(filtered, SEARCH_GROUP));
      return out;
    }
    if (groupFilter === WEB_BONUS_GROUP) {
      out.push({ kind: "header", group: { groupKey: WEB_BONUS_GROUP, groupTitle: WEB_BONUS_LABEL, subGroupTitle: null, badgeText: "無料", displayOrder: null, description: "ふわっちの WEB おまけ・無料配布アイテムを名前で束ねています（ネズミ・メガホン・ハート・拍手・(Web)）。価格ありの同名アイテムはアイテムページのカテゴリ側に出ます。見つからない場合は上の検索欄に名前を入れてください", itemCount: webBonus.length }, count: webBonus.length });
      out.push(...chunkItems(webBonus, WEB_BONUS_GROUP));
      return out;
    }
    if (groupFilter === NONE_GROUP) {
      out.push({ kind: "header", group: { groupKey: NONE_GROUP, groupTitle: "分類なし", subGroupTitle: null, badgeText: null, displayOrder: null, description: "無料アイテム・販売終了・イベント限定など、ふわっちのアイテムページの見出しに無いアイテム。無料アイテムの既定 SE は上の「価格帯ごとの既定 SE」で変えられます", itemCount: unclassified.length }, count: unclassified.length });
      out.push(...chunkItems(unclassified, NONE_GROUP));
      return out;
    }
    const targets = groupFilter === "all" ? groups : groups.filter((g) => g.groupKey === groupFilter);
    for (const group of targets) {
      const sectionItems = filtered.filter((i) => (i.groups ?? []).includes(group.groupKey));
      // 「すべて」表示で 0 件のカテゴリ（絞り込みで消えた等）は見出しごと省く。単独選択なら 0 件でも見出しは出す
      if (sectionItems.length === 0 && groupFilter === "all") continue;
      out.push({ kind: "header", group, count: sectionItems.length });
      out.push(...chunkItems(sectionItems, group.groupKey));
    }
    return out;
  }, [filtered, groups, groupFilter, unclassified, webBonus, query]);
  const visibleItemCount = useMemo(() => rows.reduce((n, r) => n + (r.kind === "items" ? r.items.length : 0), 0), [rows]);

  /** カテゴリの表示名。ふわっちAPIの title + badge_text（アイテムページの見出しとは異なる場合がある） */
  const groupLabel = (g: GroupRow) => `${g.badgeText ? `${g.badgeText} / ` : ""}${g.groupTitle}${g.subGroupTitle ? `（${g.subGroupTitle}）` : ""}`;

  // 1,900 件超を一度に描画すると重いので、見えている行だけ描画する（行の高さはパターン数・バナーで変わるため実測させる）
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: (index) => (rows[index]?.kind === "header" ? (rows[index].group.bannerUrl ? 260 : 140) : 240),
    overscan: 6,
  });

  /**
   * SE 割り当ての保存。同じ見た目のパターンが複数 pattern_id に散っていることがあるため、
   * まとめて同じ内容を書く（どの pattern_id で飛んできても同じ音が鳴るように）
   */
  const upsert = async (keys: string[], patch: Partial<Mapping>) => {
    setBusyKey(keys[0]);
    say(keys[0], null);
    try {
      const saved: Mapping[] = [];
      for (const key of keys) {
        const res = await fetch("/api/se/mappings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, ...patch }) });
        if (!res.ok) {
          const d = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(d?.error ?? "保存に失敗しました");
        }
        const d = (await res.json()) as { mapping: Mapping };
        saved.push(d.mapping);
      }
      setUserRows((prev) => [...prev.filter((m) => !keys.includes(m.key)), ...saved]);
    } catch (e) {
      const message = e instanceof Error ? e.message : "通信エラー";
      say(keys[0], message);
      throw e instanceof Error ? e : new Error(message);
    } finally {
      setBusyKey(null);
    }
  };

  const reset = async (keys: string[]) => {
    setBusyKey(keys[0]);
    try {
      for (const key of keys) await fetch(`/api/se/mappings?key=${encodeURIComponent(key)}`, { method: "DELETE" });
      setUserRows((prev) => prev.filter((m) => !keys.includes(m.key)));
    } finally {
      setBusyKey(null);
    }
  };

  const upload = async (keys: string[], file: File) => {
    const key = keys[0];
    if (file.size > MAX_BYTES) {
      say(key, `20MB 以下のファイルにしてください: ${describeFile(file)}`);
      return;
    }
    if (!EXT_RE.test(file.name)) {
      say(key, `mp3 / ogg / wav / m4a / aac のみ対応です: ${describeFile(file)}`);
      return;
    }
    setBusyKey(key);
    say(key, null);
    try {
      // アップロードはサーバ経由（/api/se/upload）。ブラウザ側の Supabase クライアントに頼ると、
      // Service Worker が古い JS を配っている間だけ認証が取れず「ログインが必要です」になる（2026-09-25）
      const form = new FormData();
      form.set("file", file);
      form.set("key", key);
      const res = await fetch("/api/se/upload", { method: "POST", body: form });
      const d = (await res.json().catch(() => null)) as { url?: string; label?: string; error?: string } | null;
      if (!res.ok || !d?.url) {
        say(key, res.status === 401 ? "セッションが切れています。ページを更新してログインし直してください" : `${d?.error ?? `アップロード失敗（HTTP ${res.status}）`} — ${describeFile(file)}`);
        return;
      }
      await upsert(keys, { url: d.url, label: d.label ?? file.name });
      say(key, `${file.name} を割り当てました`);
    } catch (e) {
      say(key, `アップロード失敗: ${e instanceof Error ? e.message : String(e)} — ${describeFile(file)}`);
    } finally {
      setBusyKey(null);
    }
  };

  const preview = async (key: string, tier: SeTier, volumeOverride?: number) => {
    await unlockAudio();
    const m = byKey.get(key);
    await playSe(tier, { url: m?.url ?? null, volume: (volumeOverride ?? m?.volume ?? 80) / 100 });
  };

  /** 行ごとの操作部品に渡す値（部品自体はモジュール直下の memo コンポーネント） */
  const ctl = (keys: string[]) => ({
    mapping: byKey.get(keys[0]),
    busy: busyKey === keys[0],
    message: msgKey === keys[0] ? msg : null,
    onUpload: upload,
    onUpsert: upsert,
    onReset: reset,
    onPreview: preview,
  });

  return (
    <div className="space-y-4">
      {/* S2: プリセットの保存・共有・取り込み */}
      <SePresetPanel onApplied={reloadAll} />

      {/* ティア既定音 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h4 className="mb-1 text-sm font-bold text-foreground">価格帯ごとの既定 SE（無料アイテムを含む）</h4>
        <p className="mb-1 text-xs text-muted-foreground">
          アイテム個別・カテゴリの割り当てが無い時に使われます。既定は公式音源（{defaultsSource === "sync" ? "運営の現在の設定に同期" : "同梱"}。どこにも無い価格帯は「きらきら輝く1」）。音源を上げると差し替わり、「既定に戻す」で公式音源に戻ります
        </p>
        <p className="mb-3 text-xs text-muted-foreground">
          <span className="font-bold text-foreground">無料アイテム</span>
          （イベントの無料配布など価格の無いアイテム）は、ふわっちのアイテムページの見出しに無くカテゴリが付かないため、ここの「{TIER_LABELS.T0}」に従います。特定の無料アイテムだけ変えたい場合は、下のカテゴリを「分類なし」にして個別に割り当ててください
        </p>
        <div className="space-y-2">
          {TIERS.map((t) => (
            <div key={t} className="flex flex-wrap items-center gap-2 border-b border-border py-2 text-xs last:border-0">
              <span className="w-44 shrink-0 text-foreground">{TIER_LABELS[t]}</span>
              <MappingControls mkeys={[`tier:${t}`]} tier={t} {...ctl([`tier:${t}`])} />
            </div>
          ))}
        </div>
      </div>

      {/* 種類ごとの一括割り当て */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h4 className="mb-1 text-sm font-bold text-foreground">種類ごとの SE（まとめて割り当て）</h4>
        <p className="mb-3 text-xs text-muted-foreground">アイテム個別の割り当てがある場合はそちらが優先されます。価格帯の既定より優先</p>
        <div className="space-y-2">
          {KINDS.map((k) => (
            <div key={k} className="flex flex-wrap items-center gap-2 border-b border-border py-2 text-xs last:border-0">
              <span className="w-44 shrink-0 text-foreground">
                {ITEM_KIND_LABELS[k]}
                <span className="ml-2 text-muted-foreground">{items ? `${items.filter((i) => itemKind(i.patterns) === k).length} 件` : ""}</span>
              </span>
              <MappingControls mkeys={[`cat:kind:${k}`]} tier={KIND_PREVIEW_TIER[k]} {...ctl([`cat:kind:${k}`])} />
            </div>
          ))}
        </div>
      </div>

      {/* アイテム一覧 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-bold text-foreground">アイテムごとの SE</h4>
          <span className="text-xs text-muted-foreground">
            {items ? `${items.length} アイテム` : ""}
            {syncedAt ? ` · マスタ同期 ${new Date(syncedAt).toLocaleString("ja-JP")}` : ""}
          </span>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="名前で検索（全アイテム）" className="ml-auto min-h-9 w-44 rounded-sm bg-muted px-3 text-xs text-foreground" />
          <label className="flex items-center gap-1 text-xs text-muted-foreground" title="OFF にすると分類なしの無料・価格なしアイテムも出ます（イベント配布の無料アイテムは ON でもカテゴリ内に出ます）">
            <input type="checkbox" checked={onlyOnSale} onChange={(e) => setOnlyOnSale(e.target.checked)} className="size-4" />
            価格ありのみ
          </label>
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-1">
          {(["all", ...KINDS] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKindFilter(k)}
              className={`min-h-9 rounded-full px-3 text-xs ${kindFilter === k ? "bg-primary text-primary-foreground" : "border border-border bg-muted text-foreground hover:border-foreground/30"}`}
            >
              {k === "all" ? "すべて" : ITEM_KIND_LABELS[k]}
            </button>
          ))}
          <span className="ml-1 text-xs text-muted-foreground">{visibleItemCount} 件</span>
        </div>

        {/* カテゴリ（アイテムページの見出し） */}
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <label htmlFor="se-group-filter" className="text-xs font-medium text-foreground">
            カテゴリ
          </label>
          <select
            id="se-group-filter"
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="min-h-9 max-w-full rounded-sm border border-border bg-muted px-2 text-xs text-foreground"
          >
            <option value="all">すべてのカテゴリ（アイテムページ順）</option>
            <option value={WEB_BONUS_GROUP}>{WEB_BONUS_LABEL}{items ? `（${(items ?? []).filter(isWebBonusItem).length}）` : ""}</option>
            {groups.map((g) => (
              <option key={g.groupKey} value={g.groupKey}>
                {groupLabel(g)}（{g.itemCount}）
              </option>
            ))}
            <option value={NONE_GROUP}>分類なし（無料・販売終了・その他）{items ? `（${(items ?? []).filter((i) => (i.groups?.length ?? 0) === 0).length}）` : ""}</option>
          </select>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          カテゴリごとの見出しの中で、そのカテゴリ全部にまとめて SE を割り当てられます（アイテム個別・パターン個別の割り当てが優先）。表示名はふわっちAPIの名称で、アイテムページの見出しと異なる場合があります。分類なしのアイテムはプルダウンから表示します
        </p>

        {msg && <p className="mb-2 text-xs text-status-warning">{msg}</p>}
        {items === null ? (
          <div className="h-16 animate-pulse rounded-lg bg-muted" />
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground">アイテムマスタが空です。Actions「Whowatch item patterns sync」を実行してください（0014 適用後）</p>
        ) : rows.length === 0 || (groupFilter === "all" && groups.length === 0) ? (
          <p className="text-xs text-muted-foreground">
            {groups.length === 0
              ? "カテゴリがまだ同期されていません（マスタ同期の実行後にアイテムページ順で並びます）。分類なしはプルダウンから表示できます"
              : "条件に合うアイテムがありません（カテゴリは、ふわっちが現在販売中のものだけ取得できます。終了したセールのアイテムは「分類なし」に入ります）"}
          </p>
        ) : (
          <div ref={listRef} className="max-h-[70vh] overflow-auto">
            <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
              {rowVirtualizer.getVirtualItems().map((row) => {
                const r = rows[row.index];
                if (r.kind === "header") {
                  const g = r.group;
                  const isPseudo = PSEUDO_GROUPS.has(g.groupKey);
                  const catKey = `cat:group:${g.groupKey}`;
                  // バナー画像が無いカテゴリは、所属アイテムの画像を並べて見出しにする（アイテムページの雰囲気に寄せる）
                  const thumbs = g.bannerUrl
                    ? []
                    : rows
                        .slice(row.index + 1)
                        .filter((x): x is Extract<ListRow, { kind: "items" }> => x.kind === "items" && x.groupKey === g.groupKey)
                        .flatMap((x) => x.items.map((it) => it.imageUrl))
                        .filter((u): u is string => Boolean(u))
                        .slice(0, 8);
                  return (
                    <div key={`h:${g.groupKey}`} data-index={row.index} ref={rowVirtualizer.measureElement} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${row.start}px)` }}>
                      <div className="mb-3 overflow-hidden rounded-xl border border-border bg-muted/40">
                        {g.bannerUrl ? (
                          // ふわっちのアイテムページのバナーをそのまま見出しに使う（外部 URL なので next/image は使わない）
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={g.bannerUrl} alt={groupLabel(g)} loading="lazy" className="w-full object-cover" />
                        ) : (
                          <div className="flex flex-wrap items-center gap-3 bg-primary/10 px-4 py-3">
                            {thumbs.length > 0 && (
                              <div className="flex -space-x-2">
                                {thumbs.map((u, i) => (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img key={`${u}-${i}`} src={u} alt="" loading="lazy" className="size-10 rounded-full border border-border bg-card object-contain" />
                                ))}
                              </div>
                            )}
                            {g.badgeText && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{g.badgeText}</span>}
                            <span className="text-base font-bold text-foreground">{g.groupTitle}</span>
                            {g.subGroupTitle && <span className="text-xs text-muted-foreground">{g.subGroupTitle}</span>}
                          </div>
                        )}
                        <div className="space-y-2 p-3">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            {g.bannerUrl && g.badgeText && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{g.badgeText}</span>}
                            {g.bannerUrl && <span className="font-bold text-foreground">{g.groupTitle}{g.subGroupTitle ? `（${g.subGroupTitle}）` : ""}</span>}
                            <span className="text-muted-foreground">{r.count} アイテム</span>
                            {!isPseudo && isUser(catKey) && <span className="rounded-full bg-status-warning/10 px-2 py-0.5 text-status-warning">カテゴリ一括 割り当て済み</span>}
                          </div>
                          {g.description && <p className="text-xs text-muted-foreground">{g.description}</p>}
                          {!isPseudo && (
                            <div>
                              <p className="mb-1 text-xs text-muted-foreground">このカテゴリ全部にまとめて割り当て（アイテム個別・パターン個別が優先。種類ごと・価格帯の既定より優先）</p>
                              <MappingControls mkeys={[catKey]} tier="T2" {...ctl([catKey])} />
                            </div>
                          )}
                          {g.groupKey === WEB_BONUS_GROUP && webBonusKeys.length > 0 && (
                            <div>
                              <p className="mb-1 text-xs text-muted-foreground">ここに出ている {webBonusKeys.length} アイテム全部にまとめて割り当て（アイテムごとの設定として保存されるので、あとで個別に変えられます）</p>
                              <MappingControls mkeys={webBonusKeys} tier="T0" {...ctl(webBonusKeys)} />
                            </div>
                          )}
                          {r.count === 0 && <p className="text-xs text-muted-foreground">条件に合うアイテムがありません（「価格ありのみ」や種類の絞り込みを見直してください）</p>}
                        </div>
                      </div>
                    </div>
                  );
                }
                // アイテムの段: ふわっちのアイテムページと同じく 3 列のグリッド（画像・名前・価格）で並べ、SE の設定をその下に付ける
                return (
                  <div key={`r:${r.groupKey}:${r.items[0]?.itemId ?? row.index}`} data-index={row.index} ref={rowVirtualizer.measureElement} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${row.start}px)` }}>
                    <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {r.items.map((it) => {
                        const tier = tierForGift({ priceYen: it.priceJpy, count: 1, isHit: false });
                        const kind = itemKind(it.patterns);
                        // パターン単位の個別割り当ては「当たり」と「名前で見分けがつくパターン」だけ出す。
                        // 見た目も名前も同じパターンが並ぶだけのアイテム（実測: 水上花火は17パターン全て同一）は
                        // 選びようが無いのでアイテム行に集約する。判定は pattern-rows.ts を参照
                        const special = expandablePatternRows(it.itemName, it.patterns);
                        return (
                          <div key={it.itemId} className="rounded-xl border border-border bg-card p-3">
                            <div className="flex gap-3">
                              {it.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={it.imageUrl} alt={it.itemName} loading="lazy" className="size-20 shrink-0 rounded-lg bg-muted object-contain" />
                              ) : (
                                <div className="flex size-20 shrink-0 items-center justify-center rounded-lg bg-muted text-[10px] text-muted-foreground">画像なし</div>
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-bold leading-tight text-foreground">{it.itemName}</p>
                                <p className="mt-0.5 text-sm font-bold text-ember-pulse">{it.priceJpy !== null ? `¥${it.priceJpy.toLocaleString()}〜` : (it.groups?.length ?? 0) > 0 ? "無料（イベント配布）" : "無料 / 価格なし"}</p>
                                <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
                                  <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{tier}</span>
                                  <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{ITEM_KIND_LABELS[kind]}</span>
                                  <span className="text-muted-foreground">{it.patterns.length} パターン</span>
                                  {(it.groups ?? [])
                                    .filter((gk) => gk !== r.groupKey)
                                    .map((gk) => {
                                      const g = groups.find((x) => x.groupKey === gk);
                                      return (
                                        <span key={gk} className="rounded-full bg-primary/10 px-2 py-0.5 text-primary" title="このカテゴリにも属しています">
                                          {g ? g.groupTitle : gk}
                                        </span>
                                      );
                                    })}
                                  {isUser(`item:${it.itemId}`) && <span className="rounded-full bg-status-warning/10 px-2 py-0.5 text-status-warning">上書き中</span>}
                                </div>
                              </div>
                            </div>
                            <div className="mt-2 border-t border-border pt-2">
                              <MappingControls mkeys={[`item:${it.itemId}`]} tier={tier} {...ctl([`item:${it.itemId}`])} />
                            </div>
                            {special.map((g) => {
                              const keys = g.patternIds.map((id) => `pattern:${id}`);
                              return (
                                <div key={g.label} className="mt-2 border-t border-border pt-2">
                                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-status-warning">
                                    <span>
                                      {ITEM_KIND_LABELS[patternKind(g.representative)]}: {g.label}
                                      {g.representative.hitGrade ? `（${g.representative.hitGrade}）` : ""}
                                    </span>
                                    {g.patternIds.length > 1 && <span className="text-muted-foreground">同名 {g.patternIds.length} パターンにまとめて割り当て</span>}
                                    {keys.some((k) => isUser(k)) && <span className="rounded-full bg-status-warning/10 px-2 py-0.5">上書き中</span>}
                                  </div>
                                  <MappingControls mkeys={keys} tier={g.isHit ? "hit" : tier} {...ctl(keys)} />
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

interface MappingControlsProps {
  mkeys: string[];
  tier: SeTier;
  mapping: MergedMapping | undefined;
  busy: boolean;
  /** この行に対する直近のメッセージ（失敗・完了） */
  message: string | null;
  onUpload: (keys: string[], file: File) => void | Promise<void>;
  onUpsert: (keys: string[], patch: Partial<Mapping>) => Promise<void>;
  onReset: (keys: string[]) => Promise<void>;
  onPreview: (key: string, tier: SeTier, volume?: number) => Promise<void>;
}

/**
 * 音源アップロード・音量・鳴らす・既定に戻す の 1 行分。
 * コンポーネント内で定義せずここに置くのが重要（親の再描画で <input type="file"> が作り直されると、
 * 開いているファイル選択ダイアログの結果が捨てられる。2026-09-26）
 */
const MappingControls = memo(function MappingControls({ mkeys, tier, mapping: m, busy, message, onUpload, onUpsert, onReset, onPreview }: MappingControlsProps) {
  const mkey = mkeys[0];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="min-h-9 cursor-pointer rounded-full border border-border bg-muted px-3 text-xs leading-9 text-foreground">
        {busy ? "処理中..." : m?.url && !m.usesDefaultSound ? "音源を変更" : "音源をアップロード"}
        <input
          type="file"
          accept={ACCEPT}
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            // 同じファイルをもう一度選んでも change が飛ぶよう、受け取ったら値を空にする
            e.target.value = "";
            if (f) void onUpload(mkeys, f);
          }}
        />
      </label>
      <VolumeSlider value={m?.volume ?? 80} onCommit={(v) => onUpsert(mkeys, { volume: v })} onPreview={(v) => void onPreview(mkey, tier, v)} />
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        <input type="checkbox" checked={m?.enabled ?? true} onChange={(e) => void onUpsert(mkeys, { enabled: e.target.checked })} className="size-4" />
        鳴らす
      </label>
      {m && m.source === "user" && (
        <button type="button" onClick={() => void onReset(mkeys)} className="min-h-9 rounded-full px-2 text-xs text-muted-foreground hover:text-destructive">
          既定に戻す
        </button>
      )}
      <span className="truncate text-xs text-muted-foreground">
        {m?.usesDefaultSound ? `既定 ♪ ${m.label ?? "公式音源"}` : m?.url ? `♪ ${m.label ?? "カスタム音源"}` : "既定（合成音）"}
      </span>
      {message && <p className="w-full text-xs text-status-warning">{message}</p>}
    </div>
  );
});
