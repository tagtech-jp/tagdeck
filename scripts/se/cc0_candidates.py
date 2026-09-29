# -*- coding: utf-8 -*-
"""CC0 の候補を一覧する（手で選ぶための下調べ）。
  python cc0_candidates.py defaults [名前...]   … 公式既定の差し替え音（DEFAULT_SPECS）
  python cc0_candidates.py lite [テーマ...]     … 無料アイテムの単発音（THEMES の検索語）
  python cc0_candidates.py theme [テーマ...]    … ミックスの主役（THEMES）
  python cc0_candidates.py q "検索語" 最大秒     … 任意の Freesound CC0 検索
出力: id  秒  DL数  作者 | タイトル
"""
import sys

import build_se_cc0 as c


def dur_of(it):
    if it.get("dur"):
        return it["dur"]
    try:
        return c.probe(it["path"]) if it["source"] == "kenney" else None
    except Exception:
        return None


def show(title, items, n=14):
    print(f"## {title}")
    for it in items[:n]:
        d = dur_of(it)
        print(f"  {it['id']:<44} {d if d is None else round(d, 2)!s:>6}s {it.get('downloads', ''):>6} {it.get('author', '')[:14]:<14} | {it['title'][:70]}")


def main():
    mode = sys.argv[1]
    names = sys.argv[2:]
    if mode == "q":
        show(names[0], c.freesound_search(names[0], float(names[1]) if len(names) > 1 else 5), 20)
        return
    if mode == "defaults":
        specs = dict(c.DEFAULT_SPECS)
        specs.update(c.DEFAULT_SINGLE_EXTRA)
    else:
        specs = dict(c.THEMES)
        specs.update(c.SINGLE_EXTRA)
    for name in names or list(specs):
        spec = specs.get(name) or specs.get(name.replace("lite-", ""))
        if not spec:
            print(f"## {name}: spec なし")
            continue
        qs, maxsec, ban, krx, _prefer = spec
        items = c.fs_many(qs, maxsec, ban, limit=18) if qs else []
        if krx:
            items += c.kenney_match(krx)[:10]
        show(name, items, 24)


if __name__ == "__main__":
    main()
