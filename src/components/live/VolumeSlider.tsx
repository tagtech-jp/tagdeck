"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

// 音量バー共通コンポーネント。ドラッグ中は画面のローカル状態だけを更新し、保存は
// 「離したとき」か「操作が止まってから500ms」にまとめて行う（onChange 毎に保存すると
// busyKey の再レンダーでスライダーが固まる不具合があったため）。

interface VolumeSliderProps {
  value: number;
  /** 継続的（ドラッグ中も含む）に呼ばれる。ネットワークを伴わない軽い用途向け。省略可 */
  onChange?: (value: number) => void;
  /** 操作が確定した時だけ呼ばれる（離した/フォーカスを外した/操作停止500ms後/±5ボタン）。失敗したら reject または throw する */
  onCommit: (value: number) => void | Promise<void>;
  /** 試し聴き。押した瞬間のライブな値（未確定でも）が渡る */
  onPreview?: (value: number) => void;
  label?: string;
  className?: string;
}

const STEP = 1;
const BIG_STEP = 5;
const IDLE_COMMIT_DELAY_MS = 500;

function clamp(v: number): number {
  return Math.min(100, Math.max(0, Math.round(v)));
}

export function VolumeSlider({ value, onChange, onCommit, onPreview, label = "音量", className = "" }: VolumeSliderProps) {
  const [display, setDisplay] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draggingRef = useRef(false);
  const id = useId();

  // 操作中でなければ、確定値（親から来た value）に追従する
  useEffect(() => {
    if (!draggingRef.current) setDisplay(value);
  }, [value]);

  useEffect(
    () => () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    },
    [],
  );

  const commit = useCallback(
    (v: number) => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      setError(null);
      setSaving(true);
      Promise.resolve()
        .then(() => onCommit(v))
        .then(() => setSaving(false))
        .catch((e: unknown) => {
          setSaving(false);
          setError(e instanceof Error ? e.message : "保存に失敗しました");
          setDisplay(value); // 直前の確定値に戻す
        });
    },
    [onCommit, value],
  );

  const scheduleIdleCommit = useCallback(
    (v: number) => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => commit(v), IDLE_COMMIT_DELAY_MS);
    },
    [commit],
  );

  /** ドラッグ・キー操作・数値入力中のライブ更新（即座に画面へ反映し、保存はデバウンスに任せる） */
  const setLive = useCallback(
    (v: number) => {
      setDisplay(v);
      onChange?.(v);
      scheduleIdleCommit(v);
    },
    [onChange, scheduleIdleCommit],
  );

  const valueFromPointer = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return display;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) return display;
      return clamp(((clientX - rect.left) / rect.width) * 100);
    },
    [display],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setLive(valueFromPointer(e.clientX));
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    setLive(valueFromPointer(e.clientX));
  };
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    draggingRef.current = false;
    commit(display); // 離した瞬間に確定（500ms 待たない）
  };

  /** ±5 ボタン・Home/End など離散操作は即座に確定してよい */
  const step = useCallback(
    (delta: number) => {
      setDisplay((prev) => {
        const v = clamp(prev + delta);
        draggingRef.current = false;
        onChange?.(v);
        commit(v);
        return v;
      });
    },
    [commit, onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      step(-STEP);
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      step(STEP);
    } else if (e.key === "Home") {
      e.preventDefault();
      step(-display);
    } else if (e.key === "End") {
      e.preventDefault();
      step(100 - display);
    } else if (e.key === "PageDown") {
      e.preventDefault();
      step(-BIG_STEP);
    } else if (e.key === "PageUp") {
      e.preventDefault();
      step(BIG_STEP);
    }
  };

  const handleNumberChange = (raw: string) => {
    const n = Number(raw);
    if (Number.isNaN(n)) return;
    setLive(clamp(n));
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
      <span className="w-9 shrink-0 text-right font-mono text-base font-bold text-foreground" aria-hidden="true">
        {display}
      </span>
      <button
        type="button"
        onClick={() => step(-BIG_STEP)}
        className="flex min-h-9 min-w-9 items-center justify-center rounded-full border border-border bg-muted text-xs text-foreground hover:border-foreground/30"
        aria-label="音量を5下げる"
      >
        −5
      </button>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={display}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyDown}
        style={{ touchAction: "none" }}
        className="relative h-3 min-h-[8px] w-24 min-w-24 flex-1 cursor-pointer rounded-full bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-32"
      >
        <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${display}%` }} />
        <div className="absolute top-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center" style={{ left: `${display}%` }}>
          <div className="size-4 rounded-full border-2 border-primary bg-background shadow" />
        </div>
      </div>
      <button
        type="button"
        onClick={() => step(BIG_STEP)}
        className="flex min-h-9 min-w-9 items-center justify-center rounded-full border border-border bg-muted text-xs text-foreground hover:border-foreground/30"
        aria-label="音量を5上げる"
      >
        +5
      </button>
      <input
        id={`${id}-number`}
        type="number"
        min={0}
        max={100}
        value={display}
        onChange={(e) => handleNumberChange(e.target.value)}
        onBlur={() => commit(display)}
        className="min-h-9 w-16 rounded-sm border border-border bg-muted px-2 text-xs text-foreground"
      />
      {onPreview && (
        <button
          type="button"
          onClick={() => onPreview(display)}
          className="min-h-9 shrink-0 rounded-full border border-border bg-muted px-3 text-xs text-foreground hover:border-foreground/30"
        >
          試し聴き
        </button>
      )}
      {saving && (
        <span className="text-[10px] text-muted-foreground" aria-live="polite">
          保存中…
        </span>
      )}
      {error && (
        <span className="text-[10px] font-bold text-destructive" aria-live="assertive">
          {error}
        </span>
      )}
    </div>
  );
}
