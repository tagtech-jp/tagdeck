"use client";

import { memo, useState } from "react";
import { PACK_GENERIC, packCategoryLabel, planPackImport, type PackFile, type PackItem, type PackPlan } from "@/lib/se/pack-import";

// 音源フォルダの一括取り込み（2026-10-17 社長指示「手元に用意した音源を、プログラムで自動解析してアイテムへ一括割り当て」）。
// 分類と計画は src/lib/se/pack-import.ts（純関数）。ここは選択 → 計画の表示 → アップロード（/api/se/upload・1 ファイル 1 回）→
// まとめて保存（/api/se/mappings/batch）→ 取り消し（同 DELETE）の流れだけ。
// SeMappingTab と同じく、<input type="file"> を持つのでモジュール直下の memo コンポーネントにする（親の再描画で作り直されないように）

interface Props {
  /** 割り当ての対象（SE タブの絞り込み後のアイテム） */
  items: PackItem[];
  /** 対象の説明（「価格ありのみ」など） */
  targetLabel: string;
  /** 保存・取り消しのあとに割り当て一覧と再生側を読み直す */
  onImported: () => Promise<void>;
}

type Phase = "idle" | "planned" | "uploading" | "saving" | "done" | "undoing";

/** /api/se/mappings/batch の 1 回あたりの行数（上限 500） */
const BATCH_ROWS = 300;

async function putBatch(rows: Array<{ key: string; url: string; label: string }>): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_ROWS) {
    const res = await fetch("/api/se/mappings/batch", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: rows.slice(i, i + BATCH_ROWS) }) });
    if (!res.ok) {
      const d = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(d?.error ?? `保存に失敗しました（HTTP ${res.status}）`);
    }
  }
}

async function deleteBatch(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += BATCH_ROWS) {
    const res = await fetch("/api/se/mappings/batch", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keys: keys.slice(i, i + BATCH_ROWS) }) });
    if (!res.ok) {
      const d = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(d?.error ?? `取り消しに失敗しました（HTTP ${res.status}）`);
    }
  }
}

export const SePackImportCard = memo(function SePackImportCard({ items, targetLabel, onImported }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [plan, setPlan] = useState<PackPlan | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 直前の取り込みで書いた key（取り消し用。ページを離れると消える。個別の「既定に戻す」はいつでも使える） */
  const [importedKeys, setImportedKeys] = useState<string[]>([]);
  const busy = phase === "uploading" || phase === "saving" || phase === "undoing";

  const pick = (list: FileList | null) => {
    const arr = list ? Array.from(list) : [];
    if (arr.length === 0) return;
    const packFiles: PackFile[] = arr.map((f) => ({ name: f.name, relPath: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, size: f.size }));
    setFiles(arr);
    setPlan(planPackImport(packFiles, items));
    setPhase("planned");
    setError(null);
    setProgress(null);
  };

  const run = async () => {
    if (!plan || plan.assignments.length === 0) return;
    setError(null);
    try {
      setPhase("uploading");
      // 同じファイルは 1 回だけ上げ、複数の行から同じ URL を参照する
      const urls = new Map<number, string>();
      for (const [n, idx] of plan.usedFiles.entries()) {
        const file = files[idx];
        setProgress(`アップロード ${n + 1}/${plan.usedFiles.length}: ${file.name}`);
        const form = new FormData();
        form.set("file", file);
        // アップロード API の key はファイルの置き場の名前にだけ使う（最初に使う行の key）
        form.set("key", plan.assignments.find((a) => a.fileIndex === idx)!.key);
        const res = await fetch("/api/se/upload", { method: "POST", body: form });
        const d = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
        if (!res.ok || !d?.url) throw new Error(res.status === 401 ? "セッションが切れています。ページを更新してログインし直してください" : `${d?.error ?? `アップロード失敗（HTTP ${res.status}）`} — ${file.name}`);
        urls.set(idx, d.url);
      }
      setPhase("saving");
      const rows = plan.assignments.map((a) => ({ key: a.key, url: urls.get(a.fileIndex)!, label: files[a.fileIndex].name.slice(0, 100) }));
      setProgress(`割り当てを保存中（${rows.length} 行）`);
      await putBatch(rows);
      setImportedKeys(rows.map((r) => r.key));
      setProgress(`${plan.usedFiles.length} 本を上げて ${rows.length} 行を割り当てました`);
      setPhase("done");
      await onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("planned");
    }
  };

  const undo = async () => {
    if (importedKeys.length === 0) return;
    setError(null);
    try {
      setPhase("undoing");
      setProgress(`取り消し中（${importedKeys.length} 行）`);
      await deleteBatch(importedKeys);
      setImportedKeys([]);
      setFiles([]);
      setPlan(null);
      setProgress("取り込んだ割り当てを消しました（音源ファイルは Storage に残ります）");
      setPhase("idle");
      await onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("done");
    }
  };

  const clear = () => {
    setFiles([]);
    setPlan(null);
    setPhase("idle");
    setError(null);
    setProgress(null);
  };

  const categories = plan ? Object.entries(plan.categories).sort((a, b) => b[1].length - a[1].length) : [];

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h4 className="mb-1 text-sm font-bold text-foreground">音源フォルダの一括取り込み（自分の音源をアイテムに自動で割り振る）</h4>
      <p className="mb-1 text-xs text-muted-foreground">
        手元の音源フォルダを選ぶと、サブフォルダ名とファイル名の言葉（花火・ねこ・確定・告知・先バレ・プレミア・激アツ・リーチ・ボーナス・クール〜ミラクル など）で分類し、
        アイテム名のテーマ（自動ライブラリと同じ判定）に合う音を各アイテムに最大 5 本（ランダム再生）割り当てます。
        同じテーマの音が無いアイテムには分類なしの音、それも無ければテーマ付きの音から選びます。当たりのパターンには「当たり」の音、まとめ投げの段階には「クール／グレート／ファンタスティック／ミラクル」の音が付きます。
      </p>
      <p className="mb-3 text-xs text-muted-foreground">
        音源は自分のアカウントの Storage にだけ上がり、他の利用者には配られません（公式既定の配布は CC0 の置き換えだけ）。対象は {targetLabel}。
        取り込んだ割り当ては個別の「既定に戻す」か、直後なら「取り消す」で戻せます
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className={`min-h-9 rounded-full border border-border bg-muted px-3 text-xs leading-9 text-foreground ${busy ? "opacity-50" : "cursor-pointer"}`}>
          フォルダを選ぶ
          <input
            type="file"
            multiple
            // フォルダ選択（Chrome / Edge / Safari）。React の型に無い属性なので展開で渡す
            {...({ webkitdirectory: "" } as Record<string, string>)}
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const list = e.target.files;
              pick(list);
              e.target.value = "";
            }}
          />
        </label>
        <label className={`min-h-9 rounded-full border border-border bg-muted px-3 text-xs leading-9 text-foreground ${busy ? "opacity-50" : "cursor-pointer"}`}>
          ファイルを選ぶ（複数可）
          <input
            type="file"
            multiple
            accept="audio/mpeg,audio/mp3,audio/ogg,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/x-m4a,.mp3,.ogg,.wav,.m4a,.aac"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const list = e.target.files;
              pick(list);
              e.target.value = "";
            }}
          />
        </label>
        {plan && phase === "planned" && plan.assignments.length > 0 && (
          <button type="button" onClick={() => void run()} disabled={busy} className="min-h-9 rounded-full bg-primary px-3 text-xs text-primary-foreground disabled:opacity-50">
            取り込む（{plan.usedFiles.length} 本 → {plan.assignments.length} 行）
          </button>
        )}
        {plan && !busy && phase !== "done" && (
          <button type="button" onClick={clear} className="min-h-9 rounded-full px-2 text-xs text-muted-foreground hover:text-foreground">
            やめる
          </button>
        )}
        {phase === "done" && importedKeys.length > 0 && (
          <button type="button" onClick={() => void undo()} className="min-h-9 rounded-full px-2 text-xs text-muted-foreground hover:text-destructive">
            取り消す（{importedKeys.length} 行）
          </button>
        )}
        {phase === "done" && (
          <button type="button" onClick={clear} className="min-h-9 rounded-full px-2 text-xs text-muted-foreground hover:text-foreground">
            閉じる
          </button>
        )}
      </div>
      {progress && <p className="mt-2 text-xs text-foreground">{progress}</p>}
      {error && <p className="mt-2 text-xs text-status-warning">{error}</p>}
      {plan && phase !== "idle" && (
        <div className="mt-3 space-y-1 text-xs text-muted-foreground">
          <p className="text-foreground">
            {files.length} ファイル → 対象 {items.length} アイテムのうち {plan.itemsAssigned} 件に割り当て
            {plan.itemsWithoutSound > 0 ? `（音が決まらない ${plan.itemsWithoutSound} 件は今までどおり）` : ""}
            {plan.hitPatternsAssigned > 0 ? ` · 当たりのパターン ${plan.hitPatternsAssigned} 件` : ""}
            {plan.bulkGradesAssigned > 0 ? ` · まとめ投げ ${plan.bulkGradesAssigned} 段階` : ""}
          </p>
          {plan.assignments.length === 0 && <p className="text-status-warning">割り当てられる組み合わせがありません。対象のアイテムが 0 件か、音源が当たり・段階の分類だけです</p>}
          <ul className="flex flex-wrap gap-1">
            {categories.map(([cat, idx]) => (
              <li key={cat} className={`rounded-full px-2 py-0.5 ${cat === PACK_GENERIC ? "bg-muted" : "bg-muted text-foreground"}`} title={idx.map((i) => files[i]?.name ?? "").join("\n")}>
                {packCategoryLabel(cat)} {idx.length}
              </li>
            ))}
          </ul>
          {plan.skipped.length > 0 && (
            <details>
              <summary className="cursor-pointer select-none">対象外のファイル {plan.skipped.length} 件（拡張子・20MB 超）</summary>
              <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto pr-1">
                {plan.skipped.map((s) => (
                  <li key={s.index}>
                    {files[s.index]?.name}: {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
});
