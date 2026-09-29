# -*- coding: utf-8 -*-
"""public/se/lib/manifest.json → src/lib/se/auto-library-data.ts（v7: CC0 のみ。クレジットは Freesound の音と Kenney のパック）"""
import io
import json
import os
import sys

W = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
m = json.load(open(W + "/public/se/lib/manifest.json", encoding="utf-8"))
lines = [
    "// 自動生成: scripts/se/gen_auto_library_data_cc0.py（元: public/se/lib/manifest.json）。手で編集しない。",
    f"// 生成 {m['generated_at']}・音源はすべて CC0 1.0（Freesound の CC0 フィルタ / Kenney の効果音パック）。正式リリースの音源ルールは docs/live-cockpit/README.md S23",
    "export interface AutoLibraryFile {",
    "  /** サイト相対 URL（public/se/lib/…） */",
    "  file: string;",
    "  /** ラベル表示用のタイトル */",
    "  title: string;",
    "  seconds: number;",
    "}",
    "",
    "/** ライブラリに使った素材（SE タブの出典表示用。CC0 なので表記の義務は無いが、出典を辿れるように載せる） */",
    "export interface AutoLibraryCredit {",
    "  /** 素材 ID（fs… = Freesound の音の番号 / kn-… = Kenney のパック） */",
    "  id: string;",
    "  title: string;",
    "  author: string;",
    "  /** 素材のページ */",
    "  page: string;",
    "}",
    "",
    "export const AUTO_LIBRARY: Readonly<Record<string, readonly AutoLibraryFile[]>> = {",
]
total = 0
for theme, rows in m["themes"].items():
    if not rows:
        continue
    lines.append(f"  {json.dumps(theme)}: [")
    for r in rows:
        total += 1
        lines.append(f"    {{ file: {json.dumps(r['file'])}, title: {json.dumps(r['title'], ensure_ascii=False)}, seconds: {r['seconds']} }},")
    lines.append("  ],")
lines.append("};")
lines.append("")
lines.append(f"export const AUTO_LIBRARY_FILE_COUNT = {total};")
lines.append("")

credits = m.get("credits") or {}
rows = []
for c in credits.get("freesound") or []:
    rows.append((0, int(c["id"][2:]) if c["id"][2:].isdigit() else 0, c["id"], c["title"], c.get("author") or "", c["page"]))
for page in credits.get("kenney") or []:
    pack = page.rstrip("/").split("/")[-1]
    rows.append((1, 0, f"kn-{pack}", f"Kenney {pack}", "Kenney", page))
rows.sort()
lines.append("export const AUTO_LIBRARY_CREDITS: readonly AutoLibraryCredit[] = [")
for _, _, cid, title, author, page in rows:
    lines.append(f"  {{ id: {json.dumps(cid)}, title: {json.dumps(title, ensure_ascii=False)}, author: {json.dumps(author, ensure_ascii=False)}, page: {json.dumps(page)} }},")
lines.append("];")
lines.append("")
io.open(W + "/src/lib/se/auto-library-data.ts", "w", encoding="utf-8", newline="\n").write("\n".join(lines))
print("themes", sum(1 for v in m["themes"].values() if v), "files", total, "credits", len(rows))
