# -*- coding: utf-8 -*-
"""v7（CC0）ライブラリの点検: 音量（LUFS）・真のピーク・長さ・途中の無音・同じミックス内の素材の重複"""
import json
import os
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor

PUBLIC = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public"))
m = json.load(open(os.path.join(PUBLIC, "se/lib/manifest.json"), encoding="utf-8"))


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore", cwd=("C:\\" if os.name == "nt" else None))


def measure(f):
    p = os.path.join(PUBLIC, f.lstrip("/"))
    r = run(["ffmpeg", "-hide_banner", "-nostats", "-i", p, "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"])
    i = re.findall(r"I:\s+(-?\d+(?:\.\d+)?) LUFS", r.stderr)
    tp = re.findall(r"Peak:\s+(-?\d+(?:\.\d+)?) dBFS", r.stderr)
    d = run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]).stdout.strip()
    s = run(["ffmpeg", "-hide_banner", "-nostats", "-i", p, "-af", "silencedetect=n=-45dB:d=0.4", "-f", "null", "-"]).stderr
    dur = float(d or 0)
    gaps = []
    for st, en in zip(re.findall(r"silence_start: (\d+(?:\.\d+)?)", s), re.findall(r"silence_end: (\d+(?:\.\d+)?)", s)):
        st, en = float(st), float(en)
        if st > 0.05 and en < dur - 0.3:
            gaps.append(round(en - st, 2))
    return f, (float(i[-1]) if i else None), (float(tp[-1]) if tp else None), dur, gaps


files = [(k, r) for k, rows in m["themes"].items() for r in rows]
# 5 秒未満でよいセット（無料の単発音・安いアイテム向けのレベル 1 テーマ・T1）
SHORT_OK = {"tier-T0", "tier-T1", "balloon", "bird", "cute", "food", "pop", "notify", "kids", "whoosh"}
with ThreadPoolExecutor(8) as ex:
    res = {f: (lu, tp, d, g) for f, lu, tp, d, g in ex.map(measure, [r["file"] for _, r in files])}

mix = [(k, r) for k, r in files if not (k.startswith("lite-") or k == "tier-T0")]
lite = [(k, r) for k, r in files if (k.startswith("lite-") or k == "tier-T0")]


def summary(name, rows):
    lus = [res[r["file"]][0] for _, r in rows if res[r["file"]][0] is not None]
    tps = [res[r["file"]][1] for _, r in rows if res[r["file"]][1] is not None]
    ds = [res[r["file"]][2] for _, r in rows]
    print(f"{name}: {len(rows)} 本  LUFS {min(lus):.1f}〜{max(lus):.1f}  TP 最大 {max(tps):.1f} dBFS  長さ {min(ds):.2f}〜{max(ds):.2f}s  測れない {len(rows) - len(lus)}")


summary("ミックス", mix)
summary("無料の単発音", lite)
bad = []
for k, r in files:
    lu, tp, d, g = res[r["file"]]
    if tp is not None and tp > -0.5:
        bad.append(f"ピーク高い {r['file']} {tp}")
    if g:
        bad.append(f"途中の無音 {r['file']} {g}")
    ids = [c["id"] for c in r["components"]]
    # 段階の専用ミックス（ev-*）と花火ショーは、主役の鳴き声・打ち上げ・破裂を繰り返すのが演出なので重複を許す（S25）
    if len(ids) != len(set(ids)) and not (k.startswith("ev-") or k == "fireworks"):
        bad.append(f"素材の重複 {r['file']}")
    if (k.startswith("lite-") or k == "tier-T0") and d > 1.6:
        bad.append(f"無料が長い {r['file']} {d}")
    if lu is not None and not (k.startswith("lite-") or k == "tier-T0") and lu < -17.5:
        bad.append(f"ミックスが小さい {r['file']} {lu}")
    # S25: 有料のミックスは 5 秒以上（5 秒未満でよいのは安いアイテム用のレベル 1 テーマと T1 だけ。¥160 以上はその豪華版 p-* を使う）
    if not (k.startswith("lite-") or k in SHORT_OK) and d < 5.0:
        bad.append(f"有料のミックスが 5 秒未満 {r['file']} {d:.2f}")
    if d > (20.5 if k.startswith("ev-") else 15.5):
        bad.append(f"長すぎる {r['file']} {d:.2f}")
print("問題", len(bad))
for b in bad[:40]:
    print("  ", b)
srcs = {}
for _, r in files:
    for c in r["components"]:
        srcs[c["source"]] = srcs.get(c["source"], set()) | {c["id"]}
print("素材の出典:", {k: len(v) for k, v in srcs.items()}, "ライセンス:", sorted({c["license"] for _, r in files for c in r["components"]}))
total = sum(os.path.getsize(os.path.join(PUBLIC, r["file"].lstrip("/"))) for _, r in files)
print(f"合計 {total / 1024 / 1024:.1f} MB")
