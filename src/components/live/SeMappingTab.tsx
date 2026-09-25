"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createClient } from "@/lib/supabase/client";
import { playSe, unlockAudio } from "@/lib/se/engine";
import { itemKind, ITEM_KIND_LABELS, patternKind, type ItemKind } from "@/lib/se/item-kind";
import { tierForGift, TIER_LABELS, type SeTier } from "@/lib/se/tiers";
import { expandablePatternRows } from "@/lib/se/pattern-rows";
import { VolumeSlider } from "./VolumeSlider";

// S1: SE タブ。アイテムマスタ（/playitems × payments3 の価格）を一覧し、アイテム／パターンごとに SE を割り当てる。
// 音源は Supabase Storage バケット "se"（mp3/ogg/wav・5MB 以下・パス {user_id}/…）。未設定は既定合成音。

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
  itemCount: number;
}
interface Mapping {
  key: string;
  url: string | null;
  volume: number;
  enabled: boolean;
  label: string | null;
}

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = "audio/mpeg,audio/mp3,audio/ogg,audio/wav,audio/x-wav,.mp3,.ogg,.wav";
const TIERS: SeTier[] = ["T0", "T1", "T2", "T3", "T4", "hit"];
const KINDS: ItemKind[] = ["normal", "hit", "anim"];
/** 種類ごとの一括割り当てを試聴するときの既定ティア */
const KIND_PREVIEW_TIER: Record<ItemKind, SeTier> = { normal: "T2", hit: "hit", anim: "T3" };

export function SeMappingTab() {
  const [items, setItems] = useState<ItemRow[] | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [filter, setFilter] = useState("");
  const [onlyOnSale, setOnlyOnSale] = useState(true);
  const [kindFilter, setKindFilter] = useState<ItemKind | "all">("all");
  const [groups, setGroups] = useState<GroupRow[]>([]);
  /** "all" = すべて / "none" = 分類なし（販売終了・その他） / それ以外は group_key */
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

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
      .then((r) => (r.ok ? (r.json() as Promise<{ mappings?: Mapping[] }>) : { mappings: [] }))
      .then((d: { mappings?: Mapping[] }) => setMappings(d.mappings ?? []))
      .catch(() => undefined);
  }, []);

  const byKey = useMemo(() => new Map(mappings.map((m) => [m.key, m])), [mappings]);
  const listRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    const q = filter.trim();
    return (items ?? [])
      .filter((i) => (!onlyOnSale || i.priceJpy !== null) && (!q || i.itemName.includes(q) || i.patterns.some((p) => p.patternName.includes(q))))
      .filter((i) => kindFilter === "all" || itemKind(i.patterns) === kindFilter)
      .filter((i) => groupFilter === "all" || (groupFilter === "none" ? (i.groups?.length ?? 0) === 0 : (i.groups ?? []).includes(groupFilter)));
  }, [items, filter, onlyOnSale, kindFilter, groupFilter]);

  const selectedGroup = useMemo(() => groups.find((g) => g.groupKey === groupFilter) ?? null, [groups, groupFilter]);
  /** カテゴリの表示名。ふわっちAPIの title + badge_text（アイテムページの見出しとは異なる場合がある） */
  const groupLabel = (g: GroupRow) => `${g.badgeText ? `${g.badgeText} / ` : ""}${g.groupTitle}${g.subGroupTitle ? `（${g.subGroupTitle}）` : ""}`;

  // 1,900 件超を一度に描画すると重いので、見えている行だけ描画する（行の高さはパターン数で変わるため実測させる）
  const rowVirtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 132,
    overscan: 6,
  });

  /**
   * SE 割り当ての保存。同じ見た目のパターンが複数 pattern_id に散っていることがあるため、
   * まとめて同じ内容を書く（どの pattern_id で飛んできても同じ音が鳴るように）
   */
  const upsert = async (keys: string[], patch: Partial<Mapping>) => {
    setBusyKey(keys[0]);
    setMsg(null);
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
      setMappings((prev) => [...prev.filter((m) => !keys.includes(m.key)), ...saved]);
    } catch (e) {
      const message = e instanceof Error ? e.message : "通信エラー";
      setMsg(message);
      throw e instanceof Error ? e : new Error(message);
    } finally {
      setBusyKey(null);
    }
  };

  const reset = async (keys: string[]) => {
    setBusyKey(keys[0]);
    try {
      for (const key of keys) await fetch(`/api/se/mappings?key=${encodeURIComponent(key)}`, { method: "DELETE" });
      setMappings((prev) => prev.filter((m) => !keys.includes(m.key)));
    } finally {
      setBusyKey(null);
    }
  };

  const upload = async (keys: string[], file: File) => {
    const key = keys[0];
    if (file.size > MAX_BYTES) {
      setMsg("5MB 以下のファイルにしてください");
      return;
    }
    if (!/\.(mp3|ogg|wav)$/i.test(file.name)) {
      setMsg("mp3 / ogg / wav のみ対応です");
      return;
    }
    setBusyKey(key);
    setMsg(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setMsg("ログインが必要です");
        return;
      }
      const ext = file.name.split(".").pop()!.toLowerCase();
      const path = `${user.id}/${key.replace(":", "_")}_${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("se").upload(path, file, { upsert: true, contentType: file.type || undefined });
      if (error) {
        setMsg(`アップロード失敗: ${error.message}（バケット se の作成と 0014 の適用を確認）`);
        return;
      }
      const { data } = supabase.storage.from("se").getPublicUrl(path);
      await upsert(keys, { url: data.publicUrl, label: file.name });
      setMsg(`${file.name} を割り当てました`);
    } catch (e) {
      setMsg(`アップロード失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyKey(null);
    }
  };

  const preview = async (key: string, tier: SeTier, volumeOverride?: number) => {
    await unlockAudio();
    const m = byKey.get(key);
    await playSe(tier, { url: m?.url ?? null, volume: (volumeOverride ?? m?.volume ?? 80) / 100 });
  };

  const MappingControls = ({ mkeys, tier }: { mkeys: string[]; tier: SeTier }) => {
    const mkey = mkeys[0];
    const m = byKey.get(mkey);
    const busy = busyKey === mkey;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <label className="min-h-9 cursor-pointer rounded-full border border-border bg-muted px-3 text-xs leading-9 text-foreground">
          {busy ? "処理中..." : m?.url ? "音源を変更" : "音源をアップロード"}
          <input type="file" accept={ACCEPT} className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && void upload(mkeys, e.target.files[0])} />
        </label>
        <VolumeSlider value={m?.volume ?? 80} onCommit={(v) => upsert(mkeys, { volume: v })} onPreview={(v) => void preview(mkey, tier, v)} />
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <input type="checkbox" checked={m?.enabled ?? true} onChange={(e) => void upsert(mkeys, { enabled: e.target.checked })} className="size-4" />
          鳴らす
        </label>
        {m && (
          <button type="button" onClick={() => void reset(mkeys)} className="min-h-9 rounded-full px-2 text-xs text-muted-foreground hover:text-destructive">
            既定に戻す
          </button>
        )}
        <span className="truncate text-xs text-muted-foreground">{m?.url ? `♪ ${m.label ?? "カスタム音源"}` : "既定（合成音）"}</span>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* ティア既定音 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h4 className="mb-1 text-sm font-bold text-foreground">価格帯ごとの既定 SE</h4>
        <p className="mb-3 text-xs text-muted-foreground">アイテム個別の割り当てが無い時に使われます。既定は Web Audio 合成音（権利フリー）。音源を上げると差し替わります</p>
        <div className="space-y-2">
          {TIERS.map((t) => (
            <div key={t} className="flex flex-wrap items-center gap-2 border-b border-border py-2 text-xs last:border-0">
              <span className="w-44 shrink-0 text-foreground">{TIER_LABELS[t]}</span>
              <MappingControls mkeys={[`tier:${t}`]} tier={t} />
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
              <MappingControls mkeys={[`cat:kind:${k}`]} tier={KIND_PREVIEW_TIER[k]} />
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
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="名前で絞り込み" className="ml-auto min-h-9 w-40 rounded-sm bg-muted px-3 text-xs text-foreground" />
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
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
          <span className="ml-1 text-xs text-muted-foreground">{visible.length} 件</span>
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
            <option value="all">すべて</option>
            {groups.map((g) => (
              <option key={g.groupKey} value={g.groupKey}>
                {groupLabel(g)}（{g.itemCount}）
              </option>
            ))}
            <option value="none">分類なし（販売終了・その他）</option>
          </select>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">表示名はふわっちAPIの名称です。アイテムページの見出しと異なる場合があります</p>

        {/* 選択中カテゴリの一括割り当て。個別（アイテム／パターン）の割り当てがあればそちらが優先される */}
        {selectedGroup && (
          <div className="mb-3 rounded-lg border border-border bg-muted/40 p-3">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-bold text-foreground">{groupLabel(selectedGroup)}</span>
              <span className="text-muted-foreground">{selectedGroup.itemCount} アイテムにまとめて割り当て</span>
              {byKey.has(`cat:group:${selectedGroup.groupKey}`) && <span className="rounded-full bg-status-warning/10 px-2 py-0.5 text-status-warning">割り当て済み</span>}
            </div>
            <MappingControls mkeys={[`cat:group:${selectedGroup.groupKey}`]} tier="T2" />
            <p className="mt-1 text-xs text-muted-foreground">アイテム個別・パターン個別の割り当てがある場合はそちらが優先されます。種類ごと・価格帯の既定より優先</p>
          </div>
        )}

        {msg && <p className="mb-2 text-xs text-status-warning">{msg}</p>}
        {items === null ? (
          <div className="h-16 animate-pulse rounded-lg bg-muted" />
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground">アイテムマスタが空です。Actions「Whowatch item patterns sync」を実行してください（0014 適用後）</p>
        ) : visible.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            条件に合うアイテムがありません。
            {groupFilter !== "all" && "（カテゴリは、ふわっちが現在販売中のものだけ取得できます。終了したセールのアイテムは「分類なし」に入ります）"}
          </p>
        ) : (
          <div ref={listRef} className="max-h-[70vh] overflow-auto">
            <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
              {rowVirtualizer.getVirtualItems().map((row) => {
                const it = visible[row.index];
                const tier = tierForGift({ priceYen: it.priceJpy, count: 1, isHit: false });
                const kind = itemKind(it.patterns);
                // パターン単位の個別割り当ては「当たり」と「名前で見分けがつくパターン」だけ出す。
                // 見た目も名前も同じパターンが並ぶだけのアイテム（実測: 水上花火は17パターン全て同一）は
                // 選びようが無いのでアイテム行に集約する。判定は pattern-rows.ts を参照
                const special = expandablePatternRows(it.itemName, it.patterns);
                return (
                  <div
                    key={it.itemId}
                    data-index={row.index}
                    ref={rowVirtualizer.measureElement}
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${row.start}px)` }}
                  >
                    <div className="mb-3 rounded-lg border border-border p-3">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-medium text-foreground">{it.itemName}</span>
                        <span className="text-muted-foreground">{it.priceJpy !== null ? `¥${it.priceJpy.toLocaleString()}` : "無料 / 価格なし"}</span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{tier}</span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{ITEM_KIND_LABELS[kind]}</span>
                        <span className="text-muted-foreground">{it.patterns.length} パターン</span>
                        {(it.groups ?? []).map((gk) => {
                          const g = groups.find((x) => x.groupKey === gk);
                          return (
                            <span key={gk} className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                              {g ? g.groupTitle : gk}
                            </span>
                          );
                        })}
                        {byKey.has(`item:${it.itemId}`) && <span className="rounded-full bg-status-warning/10 px-2 py-0.5 text-status-warning">上書き中</span>}
                      </div>
                      <MappingControls mkeys={[`item:${it.itemId}`]} tier={tier} />
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
                              {keys.some((k) => byKey.has(k)) && <span className="rounded-full bg-status-warning/10 px-2 py-0.5">上書き中</span>}
                            </div>
                            <MappingControls mkeys={keys} tier={g.isHit ? "hit" : tier} />
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
}
