"use client";

import { useState } from "react";
import { useEventSimulatorList } from "@/hooks/useEventSimulator";
import { EventCreateForm } from "@/components/events/EventCreateForm";
import { EventDashboard } from "@/components/events/EventDashboard";

export default function EventsPage() {
  const { events, loading, createEvent } = useEventSimulatorList();
  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Realtime反映を待たず一覧から即消すためのローカル除外セット（削除APIの成否確定後にのみ追加）
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  const visibleEvents = events.filter((e) => !deletedIds.has(e.id));
  const selectedEvent =
    visibleEvents.find((e) => e.id === selectedId) ?? visibleEvents[0] ?? null;

  const handleEventDeleted = (id: string) => {
    setDeletedIds((prev) => new Set(prev).add(id));
    if (selectedId === id) setSelectedId(null);
  };

  if (loading) {
    return (
      <div className="p-4">
        <div className="mb-4 h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-xl bg-card" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">イベント勝率シミュレーター</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            ふわっち・ニコ生のランキング型イベントをモンテカルロで予測
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="min-h-11 shrink-0 whitespace-nowrap rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            + 新規イベント
          </button>
        )}
      </div>

      {/* 新規作成フォーム */}
      {showForm && (
        <EventCreateForm
          onCreated={() => setShowForm(false)}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* イベントなし */}
      {visibleEvents.length === 0 && !showForm && (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-muted-foreground">アクティブなイベントがありません</p>
          <p className="mt-2 text-xs text-muted-foreground">
            「+ 新規イベント」からシミュレーションを開始してください
          </p>
        </div>
      )}

      {/* イベント一覧タブ */}
      {visibleEvents.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {visibleEvents.map((ev) => (
            <button
              key={ev.id}
              onClick={() => setSelectedId(ev.id)}
              className={`min-h-11 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors ${
                (selectedEvent?.id ?? null) === ev.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-foreground/30"
              }`}
            >
              {ev.name}
            </button>
          ))}
        </div>
      )}

      {/* 選択中のイベントダッシュボード */}
      {selectedEvent && (
        <EventDashboard
          event={selectedEvent}
          onDeleted={() => handleEventDeleted(selectedEvent.id)}
        />
      )}
    </div>
  );
}
