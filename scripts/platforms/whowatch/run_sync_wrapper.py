#!/usr/bin/env python3
"""TagDeck ふわっち日次同期ラッパー(暫定運用・Cloudflare Phase B 完了で削除予定)"""
import runpy
import sys
from pathlib import Path
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[3]
ENV_FILE = PROJECT_ROOT / ".env.local"
TARGET = Path(__file__).resolve().parent / "sync_items_and_events.py"

if not ENV_FILE.exists():
    print(f"[ERROR] .env.local not found at {ENV_FILE}", file=sys.stderr)
    sys.exit(2)

load_dotenv(ENV_FILE)
runpy.run_path(str(TARGET), run_name="__main__")
