"""pytest テスト: split_events_for_upsert（2026-10-07）

一覧に日付が無いイベントは started_at / ended_at をペイロードから外して upsert し、
詳細同期が概要の日程から入れた日付を NULL で消さないようにする。
実行: cd scripts/platforms/whowatch && python -m pytest test_split_events.py -v
"""
import sync_items_and_events as sut


def test_rows_without_dates_are_upserted_separately_without_date_columns():
    events = [
        {"id": 1, "event_key": "2026_10_magicfantasy", "status": "open", "started_at": "2026-09-30T15:00:00+00:00", "ended_at": "2026-10-12T14:59:59+00:00"},
        {"id": 1542, "event_key": "2026_10_gold_digger_1", "status": "open", "started_at": None, "ended_at": None},
    ]
    batches = sut.split_events_for_upsert(events)
    assert len(batches) == 2
    assert batches[0] == [events[0]]
    assert batches[1] == [{"id": 1542, "event_key": "2026_10_gold_digger_1", "status": "open"}]
    # 元の行は変えない
    assert "started_at" in events[1]


def test_empty_batches_are_dropped():
    assert sut.split_events_for_upsert([]) == []
    only_without = [{"id": 2, "event_key": "x", "status": "open", "started_at": None, "ended_at": None}]
    assert sut.split_events_for_upsert(only_without) == [[{"id": 2, "event_key": "x", "status": "open"}]]
    only_with = [{"id": 3, "event_key": "y", "status": "open", "started_at": "2026-10-01T00:00:00+00:00", "ended_at": None}]
    assert sut.split_events_for_upsert(only_with) == [only_with]
