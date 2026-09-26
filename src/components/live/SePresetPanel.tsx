"use client";

import { useCallback, useEffect, useState } from "react";
import { PRESET_NAME_MAX, SHARE_QUERY_PARAM, buildShareUrl, normalizeShareCode, type PresetApplyMode, type PresetSummary } from "@/lib/se/presets";

// S2: SE プリセット。今の SE 割り当て一式を名前付きで保存し、8 文字の共有コード（または共有 URL）で他の配信者が取り込める。
// 音源は所有者の Storage をそのまま参照する（複製しない）ため、所有者が音源を差し替えると取り込んだ側も変わる。

interface PresetRow {
  id: string;
  shareCode: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  mappingCount: number;
  ownerName: string | null;
  isMine: boolean;
  updatedAt: string;
}

interface Preview {
  preset: PresetRow;
  summary: PresetSummary;
}

interface Props {
  /** 取り込み完了後に呼ぶ（SE タブと再生側の割り当てを再読込する） */
  onApplied: () => void | Promise<void>;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const d = (await res.json().catch(() => null)) as { error?: string } | null;
  return d?.error ?? `${fallback}（HTTP ${res.status}）`;
}

export function SePresetPanel({ onApplied }: Props) {
  const [mine, setMine] = useState<PresetRow[] | null>(null);
  const [pub, setPub] = useState<PresetRow[]>([]);
  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState<PresetApplyMode | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCodeCopied] = useState<string | null>(null);
  // 公式の既定 SE（運営アカウントの現在の割り当て）をコード無しで取り込む（2026-09-26 社長指示）
  const [official, setOfficial] = useState<{ available: boolean; summary: PresetSummary | null } | null>(null);
  const [applyingOfficial, setApplyingOfficial] = useState<PresetApplyMode | null>(null);
  const [confirmOfficialReplace, setConfirmOfficialReplace] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/se/presets");
      if (!r.ok) {
        setMine([]);
        return;
      }
      const d = (await r.json()) as { mine?: PresetRow[]; public?: PresetRow[] };
      setMine(d.mine ?? []);
      setPub(d.public ?? []);
    } catch {
      setMine([]);
    }
  }, []);

  useEffect(() => {
    void load();
    fetch("/api/se/presets/default")
      .then((r) => (r.ok ? (r.json() as Promise<{ available: boolean; summary: PresetSummary | null }>) : { available: false, summary: null }))
      .then((d: { available: boolean; summary: PresetSummary | null }) => setOfficial(d))
      .catch(() => setOfficial({ available: false, summary: null }));
    // 共有 URL（/live?sePreset=CODE）で来たら取り込み欄に入れておく
    try {
      const code = new URLSearchParams(window.location.search).get(SHARE_QUERY_PARAM);
      if (code) setCodeInput(code);
    } catch {
      // クエリが読めなくても動作に影響しない
    }
  }, [load]);

  const shareUrl = (code: string) => buildShareUrl(typeof window !== "undefined" ? window.location.origin : "https://tagdeck.jp", code);

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(shareUrl(code));
      setCodeCopied(code);
      setTimeout(() => setCodeCopied(null), 2000);
    } catch {
      setMsg(`コピーできませんでした。共有コード: ${code}`);
    }
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/se/presets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), isPublic }) });
      if (!res.ok) {
        setMsg(await readError(res, "保存に失敗しました"));
        return;
      }
      const d = (await res.json()) as { preset: PresetRow };
      setName("");
      setMsg(`「${d.preset.name}」を保存しました。共有コード: ${d.preset.shareCode}（${d.preset.mappingCount} 件）`);
      await load();
    } catch {
      setMsg("通信エラー");
    } finally {
      setSaving(false);
    }
  };

  const patch = async (code: string, body: Record<string, unknown>, doneMsg: string) => {
    setBusyCode(code);
    setMsg(null);
    try {
      const res = await fetch(`/api/se/presets/${encodeURIComponent(code)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        setMsg(await readError(res, "更新に失敗しました"));
        return;
      }
      setMsg(doneMsg);
      await load();
    } catch {
      setMsg("通信エラー");
    } finally {
      setBusyCode(null);
    }
  };

  const remove = async (row: PresetRow) => {
    if (!window.confirm(`「${row.name}」を削除しますか？共有コード ${row.shareCode} は使えなくなります（取り込み済みの人の設定は変わりません）`)) return;
    setBusyCode(row.shareCode);
    setMsg(null);
    try {
      const res = await fetch(`/api/se/presets/${encodeURIComponent(row.shareCode)}`, { method: "DELETE" });
      if (!res.ok) {
        setMsg(await readError(res, "削除に失敗しました"));
        return;
      }
      setMsg(`「${row.name}」を削除しました`);
      await load();
    } catch {
      setMsg("通信エラー");
    } finally {
      setBusyCode(null);
    }
  };

  const check = async (raw?: string) => {
    const code = normalizeShareCode(raw ?? codeInput);
    if (!code) {
      setMsg("共有コードは英数字 8 文字です（共有 URL を貼っても構いません）");
      return;
    }
    setChecking(true);
    setMsg(null);
    setPreview(null);
    setConfirmReplace(false);
    try {
      const res = await fetch(`/api/se/presets/${encodeURIComponent(code)}`);
      if (!res.ok) {
        setMsg(await readError(res, "見つかりません"));
        return;
      }
      const d = (await res.json()) as Preview;
      setCodeInput(code);
      setPreview(d);
    } catch {
      setMsg("通信エラー");
    } finally {
      setChecking(false);
    }
  };

  const apply = async (mode: PresetApplyMode) => {
    if (!preview) return;
    if (mode === "replace" && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }
    setApplying(mode);
    setMsg(null);
    try {
      const res = await fetch(`/api/se/presets/${encodeURIComponent(preview.preset.shareCode)}/apply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
      if (!res.ok) {
        setMsg(await readError(res, "取り込みに失敗しました"));
        return;
      }
      const d = (await res.json()) as { applied: number; removed: number };
      setMsg(mode === "replace" ? `「${preview.preset.name}」で置き換えました（${d.applied} 件を設定、${d.removed} 件を削除）` : `「${preview.preset.name}」を追加で取り込みました（${d.applied} 件を上書き）`);
      setPreview(null);
      setConfirmReplace(false);
      await onApplied();
    } catch {
      setMsg("通信エラー");
    } finally {
      setApplying(null);
    }
  };

  const applyOfficial = async (mode: PresetApplyMode) => {
    if (mode === "replace" && !confirmOfficialReplace) {
      setConfirmOfficialReplace(true);
      return;
    }
    setApplyingOfficial(mode);
    setMsg(null);
    try {
      const res = await fetch("/api/se/presets/default", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
      if (!res.ok) {
        setMsg(await readError(res, "取り込みに失敗しました"));
        return;
      }
      const d = (await res.json()) as { applied: number; removed: number };
      setMsg(mode === "replace" ? `公式の既定 SE で置き換えました（${d.applied} 件を設定、${d.removed} 件を削除）` : `公式の既定 SE を追加で取り込みました（${d.applied} 件を上書き）`);
      setConfirmOfficialReplace(false);
      await onApplied();
    } catch {
      setMsg("通信エラー");
    } finally {
      setApplyingOfficial(null);
    }
  };

  const summaryText = (s: PresetSummary) =>
    [
      s.tiers > 0 ? `価格帯 ${s.tiers}` : null,
      s.kinds > 0 ? `種類 ${s.kinds}` : null,
      s.groups > 0 ? `カテゴリ ${s.groups}` : null,
      s.items > 0 ? `アイテム ${s.items}` : null,
      s.patterns > 0 ? `パターン ${s.patterns}` : null,
      `カスタム音源 ${s.customSounds}`,
    ]
      .filter(Boolean)
      .join(" · ");

  const rowActions = (row: PresetRow) => (
    <div className="flex flex-wrap items-center gap-1">
      <button type="button" onClick={() => void copy(row.shareCode)} className="min-h-9 rounded-full border border-border bg-muted px-3 text-xs text-foreground">
        {copied === row.shareCode ? "コピーしました" : "共有リンクをコピー"}
      </button>
      {row.isMine ? (
        <>
          <button type="button" disabled={busyCode === row.shareCode} onClick={() => void patch(row.shareCode, { refresh: true }, `「${row.name}」を今の設定で更新しました`)} className="min-h-9 rounded-full border border-border bg-muted px-3 text-xs text-foreground disabled:opacity-50">
            今の設定で更新
          </button>
          <button type="button" disabled={busyCode === row.shareCode} onClick={() => void patch(row.shareCode, { isPublic: !row.isPublic }, row.isPublic ? "非公開にしました" : "公開しました")} className="min-h-9 rounded-full border border-border bg-muted px-3 text-xs text-foreground disabled:opacity-50">
            {row.isPublic ? "非公開にする" : "公開する"}
          </button>
          <button type="button" disabled={busyCode === row.shareCode} onClick={() => void remove(row)} className="min-h-9 rounded-full px-2 text-xs text-muted-foreground hover:text-destructive disabled:opacity-50">
            削除
          </button>
        </>
      ) : (
        <button type="button" onClick={() => void check(row.shareCode)} className="min-h-9 rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground">
          取り込む
        </button>
      )}
    </div>
  );

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h4 className="mb-1 text-sm font-bold text-foreground">SE プリセット（保存して他の人と使い回す）</h4>
      <p className="mb-3 text-xs text-muted-foreground">
        今の SE 設定（価格帯・種類・カテゴリ・アイテム・パターンの割り当てと音量）をまとめて保存し、8 文字の共有コードで他の配信者がそのまま取り込めます。カスタム音源は保存した人の音源をそのまま使うので、差し替えると取り込んだ側も変わります
      </p>

      {/* 保存 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={PRESET_NAME_MAX}
          placeholder="プリセット名（例: 秋イベ用 ぬいぐるみセット）"
          className="min-h-9 min-w-56 flex-1 rounded-sm bg-muted px-3 text-xs text-foreground"
        />
        <label className="flex items-center gap-1 text-xs text-muted-foreground" title="ON にすると「みんなのプリセット」一覧に出ます。OFF でもコードを知っている人は取り込めます">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="size-4" />
          公開
        </label>
        <button type="button" onClick={() => void save()} disabled={saving || name.trim() === ""} className="min-h-9 rounded-full bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-50">
          {saving ? "保存中..." : "今の設定を保存"}
        </button>
      </div>

      {/* 公式の既定（コード不要） */}
      {official?.available && official.summary && (
        <div className="mb-3 space-y-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
          <div className="text-foreground">
            <span className="font-bold">公式の既定 SE（コード不要）</span>
            <span className="ml-2 text-muted-foreground">運営が今使っている設定。何もしなくても既定として鳴りますが、取り込むと自分の設定になり、運営が後で変えても影響を受けません</span>
          </div>
          <p className="text-muted-foreground">
            {official.summary.total} 件（{summaryText(official.summary)}）
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void applyOfficial("merge")} disabled={applyingOfficial !== null} className="min-h-9 rounded-full bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-50">
              {applyingOfficial === "merge" ? "取り込み中..." : "追加で取り込む（同じ項目は上書き）"}
            </button>
            <button type="button" onClick={() => void applyOfficial("replace")} disabled={applyingOfficial !== null} className={`min-h-9 rounded-full px-4 text-xs disabled:opacity-50 ${confirmOfficialReplace ? "bg-destructive text-destructive-foreground" : "border border-border bg-card text-foreground"}`}>
              {applyingOfficial === "replace" ? "取り込み中..." : confirmOfficialReplace ? "本当に置き換える（今の設定は消えます）" : "今の設定を全部置き換える"}
            </button>
            {confirmOfficialReplace && (
              <button type="button" onClick={() => setConfirmOfficialReplace(false)} className="min-h-9 rounded-full px-2 text-xs text-muted-foreground">
                やめる
              </button>
            )}
          </div>
        </div>
      )}

      {/* 取り込み */}
      <div className="mb-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <input
          value={codeInput}
          onChange={(e) => setCodeInput(e.target.value)}
          placeholder="共有コード（8 文字）か共有 URL"
          className="min-h-9 min-w-56 flex-1 rounded-sm bg-muted px-3 text-xs text-foreground"
        />
        <button type="button" onClick={() => void check()} disabled={checking || codeInput.trim() === ""} className="min-h-9 rounded-full border border-border bg-muted px-4 text-xs text-foreground disabled:opacity-50">
          {checking ? "確認中..." : "内容を確認"}
        </button>
      </div>
      {preview && (
        <div className="mb-3 space-y-2 rounded-lg bg-muted px-3 py-2 text-xs">
          <div className="text-foreground">
            <span className="font-bold">{preview.preset.name}</span>
            {preview.preset.ownerName ? <span className="ml-2 text-muted-foreground">by {preview.preset.ownerName}</span> : null}
            {preview.preset.isMine && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-primary">自分のプリセット</span>}
          </div>
          {preview.preset.description && <p className="text-muted-foreground">{preview.preset.description}</p>}
          <p className="text-muted-foreground">
            {preview.summary.total} 件（{summaryText(preview.summary)}）· 更新 {new Date(preview.preset.updatedAt).toLocaleString("ja-JP")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void apply("merge")} disabled={applying !== null} className="min-h-9 rounded-full bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-50">
              {applying === "merge" ? "取り込み中..." : "追加で取り込む（同じ項目は上書き）"}
            </button>
            <button type="button" onClick={() => void apply("replace")} disabled={applying !== null} className={`min-h-9 rounded-full px-4 text-xs disabled:opacity-50 ${confirmReplace ? "bg-destructive text-destructive-foreground" : "border border-border bg-card text-foreground"}`}>
              {applying === "replace" ? "取り込み中..." : confirmReplace ? "本当に置き換える（今の設定は消えます）" : "今の設定を全部置き換える"}
            </button>
            {confirmReplace && (
              <button type="button" onClick={() => setConfirmReplace(false)} className="min-h-9 rounded-full px-2 text-xs text-muted-foreground">
                やめる
              </button>
            )}
          </div>
        </div>
      )}

      {msg && <p className="mb-2 text-xs text-status-warning">{msg}</p>}

      {/* 自分のプリセット */}
      <div className="border-t border-border pt-3">
        <p className="mb-1 text-xs font-medium text-foreground">自分のプリセット</p>
        {mine === null ? (
          <div className="h-8 animate-pulse rounded bg-muted" />
        ) : mine.length === 0 ? (
          <p className="text-xs text-muted-foreground">まだありません。上の「今の設定を保存」で作れます</p>
        ) : (
          <div className="space-y-1">
            {mine.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-1.5 text-xs last:border-0">
                <span className="min-w-0 text-foreground">
                  <span className="font-bold">{row.name}</span>
                  <span className="ml-2 font-mono text-muted-foreground">{row.shareCode}</span>
                  <span className="ml-2 text-muted-foreground">{row.mappingCount} 件</span>
                  <span className={`ml-2 rounded-full px-2 py-0.5 ${row.isPublic ? "bg-status-success/10 text-status-success" : "bg-muted text-muted-foreground"}`}>{row.isPublic ? "公開" : "非公開"}</span>
                </span>
                {rowActions(row)}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* みんなのプリセット */}
      {pub.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="mb-1 text-xs font-medium text-foreground">みんなのプリセット（公開されているもの）</p>
          <div className="space-y-1">
            {pub.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-1.5 text-xs last:border-0">
                <span className="min-w-0 text-foreground">
                  <span className="font-bold">{row.name}</span>
                  {row.ownerName && <span className="ml-2 text-muted-foreground">by {row.ownerName}</span>}
                  <span className="ml-2 text-muted-foreground">{row.mappingCount} 件</span>
                  {row.description && <span className="ml-2 text-muted-foreground">{row.description}</span>}
                </span>
                {rowActions(row)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
