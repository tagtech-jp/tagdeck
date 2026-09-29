# -*- coding: utf-8 -*-
"""自動ライブラリ v7 と公式既定の差し替え音を CC0 だけで作る（2026-09-30 社長指示「正式にリリースする手順にしたい。
著作権のあるものは弾いて別の音源に差し替えてほしい」）。

出典は CC0（著作権放棄・帰属不要・再配布可・商用可）だけ:
  - Freesound: 検索フィルタ license:"Creative Commons 0"。HQ プレビュー（128kbps mp3）を使う
  - Kenney（kenney.nl）: Casino Audio / Digital Audio / Impact Sounds / Interface Sounds / Music Jingles / RPG Audio /
    Sci-Fi Sounds / UI Audio。パック同梱の License.txt が CC0 1.0
使わない（v6 まで使っていた）: Mixkit（第三者に素材を使わせることを禁止）、魔王魂（ライバー系アプリで表記なしの利用を禁止）、
  ニコニ・コモンズ（作者ごとの条件・原作性を確かめられない）、効果音ラボ（効果音を鳴らすアプリ・効果音が主役のコンテンツでの配布を禁止）。
タイトル・作者名にゲーム・アニメ・映画・企業名などが入る Freesound の音は、CC0 でも持ち込みの疑いがあるので使わない（IP_RE）。

使い方（tagdeck のリポジトリのフォルダで実行。ffmpeg / ffprobe が要る）:
  python scripts/se/build_se_cc0.py all|mix|single|defaults [セット名...]   … 音を作る（出力は public/se/lib・public/se/defaults/cc0）
  python scripts/se/build_se_cc0.py catalog                               … 選曲表（cc0_picks.py）の素材の取得先を cc0_catalog.json に書く
素材のキャッシュは %TEMP%/tagdeck_se_cc0_cache（環境変数 TAGDECK_SE_CACHE で変更）。無ければ cc0_catalog.json から取り直す。
出力先は環境変数 OUT_DIR / DEF_OUT で変更できる（確認用に別のフォルダへ出すとき）。手順は docs/live-cockpit/README.md S23
"""
import gzip
import html as H_
import json
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cc0_picks as PICKS  # noqa: E402

SCR = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(SCR, "..", ".."))
CACHE = os.environ.get("TAGDECK_SE_CACHE") or os.path.join(tempfile.gettempdir(), "tagdeck_se_cc0_cache")
CATALOG = os.path.join(SCR, "cc0_catalog.json")
FS_CACHE = os.path.join(CACHE, "freesound")
RAW = os.path.join(CACHE, "raw")
TMPD = os.path.join(CACHE, "tmp")
KENNEY = os.path.join(CACHE, "kenney")
AUD_CACHE = os.path.join(CACHE, "audible.json")
LOUD_CACHE = os.path.join(CACHE, "loudness.json")
for d in (FS_CACHE, RAW, TMPD, KENNEY):
    os.makedirs(d, exist_ok=True)
OUT = os.environ.get("OUT_DIR") or os.path.join(REPO, "public", "se", "lib")
DEF_OUT = os.environ.get("DEF_OUT") or os.path.join(REPO, "public", "se", "defaults", "cc0")
PREFIX = "v7-"
HDR = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36", "Accept": "*/*", "Accept-Encoding": "gzip", "Accept-Language": "ja,en"}
LICENSE_TEXT = {
    "freesound": "Creative Commons 0 (CC0 1.0)・Freesound の検索フィルタ license:\"Creative Commons 0\"",
    "kenney": "Creative Commons 0 (CC0 1.0)・Kenney（kenney.nl）同梱 License.txt",
}
# CC0 でも持ち込み（他人の作品の録音・リッピング）の疑いがある名前
IP_RE = re.compile(
    r"mario|nintendo|zelda|pok[eé]mon|pikachu|sonic|sega|capcom|konami|street ?fighter|mortal kombat|star ?wars|lightsaber|marvel|"
    r"disney|pixar|minecraft|fortnite|roblox|\bhalo\b|call of duty|pac-?man|tetris|kirby|metroid|donkey kong|final fantasy|dragon ?quest|"
    r"undertale|among us|simpsons|looney|scooby|batman|superman|jurassic|harry potter|james bond|\b007\b|terminator|windows|microsoft|"
    r"apple|iphone|skype|discord|whatsapp|facebook|netflix|youtube|tiktok|twitch|playstation|xbox|steam|anime|naruto|dragon ?ball|"
    r"one piece|jaws|rocky|titanic|spongebob|ghostbusters|matrix|star trek|pachinko|pachislot|jackpot sound from|ripped|sample from|"
    r"from the (movie|film|game|show|series)|tv show|commercial|jingle from|theme song|soundtrack|cover of|remix of",
    re.I,
)


def http(url, binary=False, referer=None):
    h = dict(HDR)
    if referer:
        h["Referer"] = referer
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=60) as resp:
        b = resp.read()
        if resp.headers.get("Content-Encoding") == "gzip":
            b = gzip.decompress(b)
    return b if binary else b.decode("utf-8", "ignore")


# ---------------------------------------------------------------------------
# 素材
# ---------------------------------------------------------------------------
def freesound_search(q, maxsec, minsec=0.3):
    """Freesound の CC0 だけの検索（ダウンロード数順）。結果の HTML はキャッシュする"""
    key = re.sub(r"[^a-z0-9]+", "_", q.lower()) + f"_{int(maxsec)}"
    fn = os.path.join(FS_CACHE, key + ".html")
    if os.path.exists(fn):
        h = open(fn, encoding="utf-8").read()
    else:
        url = "https://freesound.org/search/?q=" + urllib.parse.quote(q) + "&f=" + urllib.parse.quote(f'license:"Creative Commons 0" duration:[{minsec} TO {maxsec}]') + "&s=Downloads+(most+first)"
        h = http(url)
        open(fn, "w", encoding="utf-8").write(h)
        time.sleep(0.8)
    out = []
    for m in re.finditer(r"<div([^>]*data-sound-id=\"\d+\"[^>]*)>", h):
        a = m.group(1)
        g = lambda k: (re.search(k + r'="([^"]*)"', a) or [None, None])[1]
        sid, user, mp3, title, dur, dl = g("data-sound-id"), g("data-username"), g("data-mp3"), g("data-title"), g("data-duration"), g("data-num-downloads")
        if not (sid and mp3):
            continue
        title = H_.unescape(title or "")
        if IP_RE.search(title) or IP_RE.search(user or ""):
            continue
        out.append({"source": "freesound", "id": f"fs{sid}", "url": mp3.replace("-lq.mp3", "-hq.mp3"), "title": title, "author": user or "", "license": "CC0 1.0", "page": f"https://freesound.org/people/{user}/sounds/{sid}/", "dur": float(dur) if dur else None, "downloads": int(dl or 0)})
    return out


_KENNEY = None


KENNEY_PACKS = ["casino-audio", "digital-audio", "impact-sounds", "interface-sounds", "music-jingles", "rpg-audio", "sci-fi-sounds", "ui-audio"]


def ensure_kenney():
    """Kenney のパックを kenney.nl のページから取って展開する（あるものは取らない）。License.txt が CC0 でなければ止める"""
    for pack in KENNEY_PACKS:
        root = os.path.join(KENNEY, pack)
        if not os.path.isdir(root):
            page = http(f"https://kenney.nl/assets/{pack}")
            m = re.search(r"https://kenney\.nl/media/pages/assets/[^\"']+\.zip", page)
            if not m:
                raise RuntimeError(f"Kenney のダウンロード先が見つからない: {pack}")
            zpath = os.path.join(KENNEY, f"{pack}.zip")
            open(zpath, "wb").write(http(m.group(0), binary=True))
            with zipfile.ZipFile(zpath) as z:
                z.extractall(root)
        lic = [os.path.join(dp, f) for dp, _, fs in os.walk(root) for f in fs if f.lower().startswith("license") and f.lower().endswith(".txt")]
        if not lic or not any(re.search(r"CC0|Creative Commons Zero", open(p, encoding="utf-8", errors="ignore").read()) for p in lic):
            raise RuntimeError(f"Kenney のパックが CC0 と確認できない: {pack}")


def kenney_items():
    global _KENNEY
    if _KENNEY is None:
        ensure_kenney()
        _KENNEY = []
        for pack in sorted(os.listdir(KENNEY)):
            root = os.path.join(KENNEY, pack)
            if not os.path.isdir(root) or pack not in KENNEY_PACKS:
                continue
            for dp, _, fs in os.walk(root):
                for f in sorted(fs):
                    if not f.lower().endswith((".ogg", ".wav", ".mp3")) or f.lower().startswith("preview"):
                        continue
                    base = os.path.splitext(f)[0]
                    _KENNEY.append({"source": "kenney", "id": f"kn-{pack}-{base}", "path": os.path.join(dp, f), "title": f"{pack}/{base}", "author": "Kenney", "license": "CC0 1.0", "page": f"https://kenney.nl/assets/{pack}", "dur": None})
    return _KENNEY


def kenney_match(pattern):
    rx = re.compile(pattern)
    return [it for it in kenney_items() if rx.search(it["title"])]


_INDEX = None


def _parse_fs_html(h):
    out = []
    for m in re.finditer(r"<div([^>]*data-sound-id=\"\d+\"[^>]*)>", h):
        a = m.group(1)
        g = lambda k: (re.search(k + r'="([^"]*)"', a) or [None, None])[1]
        sid, user, mp3, title, dur, dl = g("data-sound-id"), g("data-username"), g("data-mp3"), g("data-title"), g("data-duration"), g("data-num-downloads")
        if not (sid and mp3):
            continue
        out.append({"source": "freesound", "id": f"fs{sid}", "url": mp3.replace("-lq.mp3", "-hq.mp3"), "title": H_.unescape(title or ""), "author": user or "", "license": "CC0 1.0", "page": f"https://freesound.org/people/{user}/sounds/{sid}/", "dur": float(dur) if dur else None, "downloads": int(dl or 0)})
    return out


_CATALOG = None


def _from_catalog(sid):
    global _CATALOG
    if _CATALOG is None:
        _CATALOG = json.load(open(CATALOG, encoding="utf-8"))["items"] if os.path.exists(CATALOG) else {}
    e = _CATALOG.get(sid)
    if not e:
        return None
    it = dict(e, id=sid)
    if it["source"] == "kenney":
        ensure_kenney()
        it["path"] = os.path.join(KENNEY, it["pack"], *it["file"].split("/"))
    return it


def resolve(sid):
    """選曲表の id（fs… / kn-…）から素材を引く。まず cc0_catalog.json、無ければ Freesound の CC0 フィルタ付き検索のキャッシュと Kenney から探す（どちらも CC0 と確認済みのものだけ）"""
    got = _from_catalog(sid)
    if got is not None:
        return got
    global _INDEX
    if _INDEX is None:
        _INDEX = {}
        for fn in sorted(os.listdir(FS_CACHE)):
            if fn.endswith(".html"):
                for it in _parse_fs_html(open(os.path.join(FS_CACHE, fn), encoding="utf-8").read()):
                    _INDEX.setdefault(it["id"], it)
        for it in kenney_items():
            _INDEX[it["id"]] = it
    it = _INDEX.get(sid)
    if it is None:
        raise KeyError(f"選曲表の素材が見つからない: {sid}")
    if IP_RE.search(it["title"]) or IP_RE.search(it.get("author", "")):
        raise ValueError(f"持ち込みの疑いのある名前: {sid} {it['title']}")
    return it


def fetch(it):
    if it["source"] == "kenney":
        return it["path"]
    fn = os.path.join(RAW, f"{it['id']}.mp3")
    if os.path.exists(fn) and os.path.getsize(fn) > 500:
        return fn
    data = http(it["url"], binary=True, referer=it["page"])
    open(fn, "wb").write(data)
    time.sleep(0.3)
    return fn


def run(cmd):
    # 長いパスの cwd では Windows の実行ファイルが起動できないので cwd を固定する
    cwd = os.environ.get("SystemDrive", "C:") + "\\" if os.name == "nt" else None
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore", cwd=cwd)


def probe(fn):
    r = run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", fn])
    try:
        return float(r.stdout.strip())
    except ValueError:
        return None


_AUD = json.load(open(AUD_CACHE, encoding="utf-8")) if os.path.exists(AUD_CACHE) else {}
_LOUD = json.load(open(LOUD_CACHE, encoding="utf-8")) if os.path.exists(LOUD_CACHE) else {}


def audible(fn):
    """鳴っている区間 (lead, tail) 秒。先頭と末尾の無音（-45dB 以下が 0.12 秒以上）を除く"""
    k = fn.replace("\\", "/").split("/cc0_cache/")[-1]
    if k in _AUD:
        return tuple(_AUD[k])
    d = probe(fn) or 0.0
    r = run(["ffmpeg", "-hide_banner", "-nostats", "-i", fn, "-af", "silencedetect=n=-45dB:d=0.12", "-f", "null", "-"])
    starts = [float(x) for x in re.findall(r"silence_start: (-?\d+(?:\.\d+)?)", r.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: (\d+(?:\.\d+)?)", r.stderr)]
    lead, tail = 0.0, d
    if starts and ends and starts[0] <= 0.02:
        lead = ends[0]
    if starts and ends and len(starts) == len(ends) and abs(ends[-1] - d) <= 0.06 and starts[-1] > lead:
        tail = starts[-1]
    elif starts and len(starts) > len(ends) and starts[-1] > lead:
        tail = starts[-1]
    if tail - lead < 0.08:
        lead, tail = 0.0, d
    _AUD[k] = [round(lead, 3), round(tail, 3)]
    json.dump(_AUD, open(AUD_CACHE, "w", encoding="utf-8"), indent=0)
    return lead, tail


def plen(it):
    lead, tail = audible(fetch(it))
    if tail - lead < 0.05:
        raise RuntimeError(f"too short {it['id']}")
    return tail - lead


def measure_lufs(fn):
    r = run(["ffmpeg", "-hide_banner", "-nostats", "-i", fn, "-af", "ebur128=framelog=quiet", "-f", "null", "-"])
    got = re.findall(r"I:\s+(-?\d+(?:\.\d+)?) LUFS", r.stderr)
    val = float(got[-1]) if got else None
    return None if val is None or val < -60 else val


def max_db(fn):
    r = run(["ffmpeg", "-hide_banner", "-nostats", "-i", fn, "-af", "volumedetect", "-f", "null", "-"])
    mm = re.search(r"max_volume:\s+(-?\d+(?:\.\d+)?) dB", r.stderr)
    return float(mm.group(1)) if mm else -3.0


def loud_db(fn):
    k = fn.replace("\\", "/").split("/cc0_cache/")[-1]
    if k in _LOUD:
        return _LOUD[k]
    val = measure_lufs(fn)
    if val is None:
        r = run(["ffmpeg", "-hide_banner", "-nostats", "-i", fn, "-af", "volumedetect", "-f", "null", "-"])
        mm = re.search(r"mean_volume:\s+(-?\d+(?:\.\d+)?) dB", r.stderr)
        val = float(mm.group(1)) if mm else -20.0
    _LOUD[k] = val
    json.dump(_LOUD, open(LOUD_CACHE, "w", encoding="utf-8"), indent=0)
    return val


def norm_gain(fn):
    return 10 ** (max(-8.0, min(8.0, -20.0 - loud_db(fn))) / 20)


# ---------------------------------------------------------------------------
# プールとテーマ（CC0 だけ）
# ---------------------------------------------------------------------------
def fs_many(queries, maxsec, ban=(), limit=12, minsec=0.3):
    res, seen = [], set()
    for q in queries:
        try:
            got = freesound_search(q, maxsec, minsec)
        except Exception as e:
            print(f"WARN freesound {q}: {e}", file=sys.stderr)
            continue
        for it in got[:14]:
            t = it["title"].lower()
            if it["id"] in seen or "loop" in t or any(b in t for b in ban):
                continue
            seen.add(it["id"])
            res.append(it)
    return res[:limit]


POOL_SPEC = {
    # プール: (Freesound の検索語, 最大秒, 除く語, Kenney の正規表現)
    "riser": (["riser whoosh", "cinematic riser", "swoosh rise", "whoosh up"], 4, ["horror", "scary", "dark", "creepy"], None),
    "impact": (["cinematic impact", "boom hit", "big impact hit"], 4, ["punch", "horror", "scary", "body"], r"impact-sounds/impact(Punch|Plate|Metal|Bell)_heavy|sci-fi-sounds/impactMetal"),
    "drumroll": (["drum roll", "snare roll", "drumroll"], 7, ["fail"], None),
    "sparkle": (["sparkle twinkle", "magic shimmer", "chime sparkle", "twinkle"], 4, ["dark", "evil"], r"digital-audio/(powerUp|pepSound|highUp)"),
    "coins": (["coins jingle", "coin shower", "coins drop", "coin collect"], 4, ["lose"], r"rpg-audio/handleCoins|casino-audio/chips-(stack|collide|handle)"),
    "win_small": (["success jingle", "level up", "achievement unlocked", "positive notification"], 3, ["fail", "lose", "wrong", "error"], r"music-jingles/jingles_(NES|PIZZI)"),
    "win_mid": (["jackpot win", "win jingle", "bonus win", "victory jingle"], 6, ["fail", "lose", "wrong"], r"music-jingles/jingles_(SAX|STEEL|PIZZI)"),
    "fanfare": (["fanfare victory", "trumpet fanfare", "brass fanfare", "fanfare"], 8, ["sad", "fail", "lose"], r"music-jingles/jingles_(HIT|SAX|STEEL)"),
    "cheer": (["crowd cheer applause", "yay crowd", "applause cheering", "crowd cheering"], 8, ["boo", "laugh"], None),
    "siren": (["slot machine jackpot", "casino jackpot bell", "jackpot alarm", "slot machine win"], 8, ["police", "ambulance", "fire truck"], None),
    "fireworks": (["fireworks", "firework crackle", "firework explosion"], 6, ["ambience"], None),
    "epic": (["epic orchestral hit", "choir triumphant", "cinematic boom", "orchestral hit"], 9, ["horror", "dark", "scary"], r"music-jingles/jingles_HIT"),
    # 確定音（パチンコの確定演出の代わり）とフィーバー（ミラクル・¥5,000〜の決め）
    "kakutei": (["slot machine win", "jackpot bell", "win stinger", "bonus bell"], 3, ["fail", "lose"], r"digital-audio/(zapThreeToneUp|threeTone|powerUp)|music-jingles/jingles_HIT"),
    "fever": ([], 8, [], r"music-jingles/jingles_(HIT|SAX|STEEL)"),
}

# テーマ: (Freesound の検索語, 最大秒, 除く語, Kenney の正規表現, 好む語)
THEMES = {
    "fireworks": (["fireworks", "firework crackle", "firework explosion"], 6, ["ambience", "distant"], None, ["firework"]),
    "fanfare": (["fanfare victory", "trumpet fanfare", "orchestral fanfare"], 8, ["sad", "fail"], r"music-jingles/jingles_(HIT|STEEL|SAX)", ["fanfare", "trumpet"]),
    "win": (["level up", "success jingle", "achievement"], 4, ["fail", "lose", "wrong"], r"music-jingles/jingles_(NES|PIZZI)", ["level", "success", "win"]),
    "jackpot": (["jackpot", "slot machine win coins", "slot machine payout"], 8, ["fail", "lose"], r"casino-audio/chips-(stack|collide)|digital-audio/threeTone", ["jackpot", "slot", "coins"]),
    "coin": (["coin drop", "coins jingle", "coin collect"], 3, ["fail", "lose", "slot"], r"rpg-audio/handleCoins|casino-audio/chip-lay", ["coin"]),
    "cheer": (["crowd cheer", "applause cheering", "crowd cheer applause"], 8, ["boo", "laugh"], None, ["cheer", "applause", "crowd"]),
    "sparkle": (["sparkle twinkle", "shimmer magic", "twinkle"], 5, ["dark", "evil"], r"digital-audio/(powerUp|pepSound|highUp)", ["sparkle", "twinkle", "shimmer"]),
    "magic": (["magic spell", "magic wand", "spell cast"], 6, ["dark", "evil", "horror"], r"digital-audio/(phaserUp|phaseJump|powerUp)", ["magic", "spell"]),
    "heart": (["kiss", "heart love chime", "cartoon kiss"], 4, ["fart", "burp"], None, ["kiss", "love", "heart"]),
    "balloon": (["balloon pop", "balloon inflate", "pop"], 4, ["gun", "shot"], None, ["balloon", "pop"]),
    "cat": (["cat meow", "kitten meow"], 3, ["angry", "hiss", "fight"], None, ["meow", "cat", "kitten"]),
    "dog": (["dog bark", "puppy bark"], 3, ["growl", "angry", "whimper"], None, ["bark", "dog", "puppy"]),
    "pig": (["pig oink", "pig snort", "pig grunt"], 3, ["scream", "slaughter"], None, ["pig", "oink"]),
    "elephant": (["elephant trumpet", "elephant"], 4, ["robot", "fake"], None, ["elephant"]),
    "wolf": (["wolf howl", "wolves howling"], 5, ["horror"], None, ["wolf", "howl"]),
    "lion": (["lion roar", "tiger roar"], 4, ["monster", "dinosaur"], None, ["lion", "roar", "tiger"]),
    "bird": (["bird chirp", "chick chirp", "songbird"], 4, ["ambience", "forest", "crow"], None, ["bird", "chirp", "chick"]),
    "horse": (["horse neigh", "horse whinny"], 4, ["scared"], None, ["horse", "neigh", "whinny"]),
    "cow": (["cow moo"], 4, [], None, ["cow", "moo"]),
    "monkey": (["monkey", "monkey chatter", "chimpanzee"], 4, ["scream"], None, ["monkey", "chimp"]),
    "bear": (["bear growl", "bear roar", "grizzly"], 4, ["zombie", "monster"], None, ["bear", "growl"]),
    "cute": (["cute cartoon boing", "squeaky toy", "cartoon pop"], 3, ["fart", "burp"], r"interface-sounds/(pluck|drop|bong)|digital-audio/pepSound", ["cute", "cartoon", "boing", "squeak"]),
    "drink": (["glass clink cheers", "champagne cork pop", "beer pour"], 4, ["break", "shatter", "smash"], r"impact-sounds/impactGlass_light", ["clink", "cheers", "cork", "glass"]),
    "food": (["crunch bite", "apple bite", "eating crunch"], 3, ["burp", "vomit"], None, ["bite", "crunch", "eat"]),
    "party": (["party horn", "party popper", "confetti"], 5, ["sad"], None, ["party", "horn", "popper"]),
    "bell": (["bell chime", "ding chime", "bell ding"], 4, ["alarm", "school", "church"], r"impact-sounds/impactBell_heavy", ["bell", "ding", "chime"]),
    "christmas": (["sleigh bells jingle", "christmas bells", "jingle bells shake"], 6, ["song"], None, ["sleigh", "jingle", "bell"]),
    "halloween": (["witch laugh", "spooky ghost", "halloween"], 5, ["scream", "blood"], None, ["witch", "ghost", "spooky"]),
    "sea": (["water splash", "splash", "dolphin"], 4, ["ambience", "rain"], None, ["splash", "water", "dolphin"]),
    "rocket": (["rocket launch", "spaceship whoosh", "ufo"], 5, ["alarm"], r"sci-fi-sounds/(thrusterFire|spaceEngineSmall)", ["rocket", "launch", "space"]),
    "explosion": (["explosion", "explosion boom", "big explosion"], 5, ["distant", "ambience"], r"sci-fi-sounds/(explosionCrunch|lowFrequency_explosion)", ["explosion", "boom"]),
    "casino": (["slot machine", "roulette wheel", "slot machine spin"], 6, ["lose"], r"casino-audio/(chips|card-shuffle|dice-shake)", ["slot", "roulette", "casino"]),
    "music": (["harp glissando", "piano chord happy", "guitar strum"], 6, ["sad", "horror"], r"music-jingles/jingles_(PIZZI|STEEL)", ["harp", "piano", "guitar"]),
    "battle": (["sword clash", "sword slash", "sword draw"], 4, ["gore", "blood"], r"rpg-audio/(drawKnife|knifeSlice)|impact-sounds/impactPunch_heavy", ["sword", "slash", "clash"]),
    "vehicle": (["car horn", "train whistle", "ship horn"], 4, ["crash"], None, ["horn", "whistle"]),
    "flower": (["wind chimes", "gentle chime", "chime nature"], 5, ["storm"], None, ["chime", "wind"]),
    "pop": (["pop bubble", "bubble pop", "blip"], 2, ["error", "wrong"], r"interface-sounds/(select|drop|toggle|pluck)|ui-audio/click", ["pop", "bubble", "blip"]),
    "trophy": (["victory fanfare", "trophy win", "winner fanfare"], 8, ["lose", "fail"], r"music-jingles/jingles_(HIT|STEEL)", ["victory", "fanfare", "win"]),
    "epic": (["epic orchestral hit", "cinematic impact", "orchestral hit"], 8, ["horror", "dark"], r"music-jingles/jingles_HIT", ["epic", "orchestral", "cinematic"]),
    "notify": (["notification chime", "notification", "message ding"], 3, ["error", "wrong", "alarm"], r"interface-sounds/(confirmation|question|glass)", ["notification", "chime", "ding"]),
    "wow": (["wow crowd", "yay cheer", "crowd ooh"], 4, ["sad", "boo"], None, ["wow", "yay", "ooh"]),
    "dice": (["dice roll", "dice shake"], 4, [], r"casino-audio/(dice|die)-", ["dice"]),
    "kids": (["kids laugh", "baby giggle", "children cheering"], 4, ["cry", "scream"], None, ["laugh", "giggle", "kids"]),
    "thunder": (["thunder strike", "lightning strike", "thunder clap"], 6, ["rain", "ambience"], None, ["thunder", "lightning"]),
    "fire": (["fire whoosh", "flame burst", "fireball"], 5, ["alarm", "ambience"], None, ["fire", "flame"]),
    "laser": (["laser zap", "laser shot", "electric zap"], 4, ["alarm"], r"digital-audio/(laser|zap)|sci-fi-sounds/laser(Small|Retro)", ["laser", "zap"]),
    "whoosh": (["whoosh", "swoosh", "fast whoosh"], 3, ["riser"], None, ["whoosh", "swoosh"]),
    "bulk-COOL": (["success jingle short", "level up"], 3, ["fail", "lose"], r"music-jingles/jingles_(NES|PIZZI)", ["success", "level"]),
    "bulk-GREAT": (["crowd cheer applause", "victory jingle"], 6, ["boo"], r"music-jingles/jingles_(STEEL|SAX)", ["cheer", "victory"]),
    "bulk-FANTASTIC": (["fanfare victory", "fireworks finale"], 8, ["sad"], r"music-jingles/jingles_(HIT|SAX)", ["fanfare", "firework"]),
    "bulk-MIRACLE": (["epic orchestral victory", "choir triumphant"], 8, ["horror", "dark"], r"music-jingles/jingles_HIT", ["epic", "choir", "victory"]),
    "tier-T0": (["pop", "bubble pop"], 2, ["error"], r"interface-sounds/(select|drop|pluck)|ui-audio/click", ["pop", "bubble"]),
    "tier-T1": (["chime notification", "bell ding"], 3, ["alarm", "error"], r"interface-sounds/(confirmation|glass)|music-jingles/jingles_PIZZI", ["chime", "ding"]),
    "tier-T2": (["coins jingle", "gold coin"], 3, ["lose"], r"rpg-audio/handleCoins|casino-audio/chips-stack", ["coin"]),
    "tier-T3": (["success fanfare", "win jingle"], 5, ["fail", "lose"], r"music-jingles/jingles_(NES|STEEL)", ["fanfare", "win"]),
    "tier-T4": (["orchestral fanfare", "brass fanfare"], 8, ["sad"], r"music-jingles/jingles_(HIT|SAX)", ["fanfare", "orchestral"]),
    "hit": (["jackpot win", "correct answer ding", "winner bell"], 6, ["fail", "lose", "wrong"], r"music-jingles/jingles_(HIT|NES)|digital-audio/threeTone", ["jackpot", "win", "correct"]),
}
# 派手さ（build_se_mix の LEVEL と同じ）と長さ
LEVEL = {
    "fireworks": 3, "fanfare": 3, "win": 2, "jackpot": 3, "coin": 2, "cheer": 3, "sparkle": 2, "magic": 2, "heart": 2, "balloon": 1,
    "cat": 2, "dog": 2, "pig": 2, "elephant": 2, "wolf": 2, "lion": 3, "bird": 1, "horse": 2, "cow": 2, "monkey": 2, "bear": 2,
    "cute": 1, "drink": 2, "food": 1, "party": 3, "bell": 2, "christmas": 2, "halloween": 2, "sea": 2, "rocket": 3, "explosion": 3,
    "casino": 3, "music": 2, "battle": 3, "vehicle": 2, "flower": 2, "pop": 1, "trophy": 4, "epic": 4, "notify": 1, "wow": 3,
    "dice": 2, "kids": 1, "thunder": 3, "fire": 3, "laser": 2, "whoosh": 1,
    "bulk-COOL": 2, "bulk-GREAT": 3, "bulk-FANTASTIC": 4, "bulk-MIRACLE": 4,
    "tier-T0": 1, "tier-T1": 1, "tier-T2": 2, "tier-T3": 3, "tier-T4": 4, "hit": 3,
}
TARGET = {1: 3.5, 2: 6.5, 3: 9.5, 4: 14.0}
TARGET_OVERRIDE = {"tier-T0": 3.0, "tier-T1": 4.0, "tier-T2": 6.0, "tier-T3": 9.0, "tier-T4": 15.0, "hit": 10.0, "bulk-COOL": 6.0, "bulk-GREAT": 9.0, "bulk-FANTASTIC": 12.0, "bulk-MIRACLE": 15.0, "epic": 15.0, "trophy": 12.0}
MAX_SEC = 15.0

POOLS = {}
_THEME_CACHE = {}


def build_pools():
    for name, ids in PICKS.POOL_PICKS.items():
        POOLS[name] = [resolve(x) for x in ids]
        print(f"pool {name}: {len(POOLS[name])}（Kenney {sum(1 for x in POOLS[name] if x['source'] == 'kenney')}）", file=sys.stderr)


def theme_mains(set_name, n=10):
    return [resolve(x) for x in PICKS.THEME_PICKS[set_name]][:n]


def pick(rng, pool, k=1, exclude=()):
    cands = [p for p in pool if p["id"] not in exclude] or list(pool)
    rng.shuffle(cands)
    return cands[:k]


HIT_CUT = {1: 1.6, 2: 1.8, 3: 2.2, 4: 2.6}
HIT_GAP_MAX = {1: 0.7, 2: 0.8, 3: 0.95, 4: 1.05}
RISER_CUT = {2: 1.0, 3: 1.4, 4: 2.2}
KAKUTEI_EXTRA = ("hit", "jackpot", "casino")


def compose(set_name, variant, mains, rng):
    """1 本分の部品を時間軸に置く（build_se_mix4.compose と同じ流れ・CC0 のプール）"""
    level = LEVEL.get(set_name, 2)
    target = min(MAX_SEC, TARGET_OVERRIDE.get(set_name, TARGET[level]))
    parts = []

    def add(it, start, cut, gain):
        parts.append((it, max(0.0, start), cut, gain))

    def used():
        return {p[0]["id"] for p in parts}

    t = 0.0
    if set_name in ("hit", "bulk-MIRACLE") and POOLS["drumroll"]:
        r = pick(rng, POOLS["drumroll"])[0]
        cut = min(plen(r), 2.4 if set_name == "hit" else 3.0)
        add(r, 0.0, cut, 0.8)
        t = cut - 0.15
    elif level >= 2 and POOLS["riser"]:
        r = pick(rng, POOLS["riser"])[0]
        cut = min(plen(r), RISER_CUT[level])
        add(r, 0.0, cut, 0.7)
        t = max(0.0, cut - 0.25)
    if level >= 3 and POOLS["impact"]:
        im = pick(rng, POOLS["impact"], exclude=used())[0]
        add(im, t, min(plen(im), 2.5), 0.85)
    hits = 2 if level == 1 else 3
    chosen = []
    if mains:
        chosen.append(mains[variant % len(mains)])
        rest = [m for m in mains if m["id"] != chosen[0]["id"]]
        rng.shuffle(rest)
        chosen += rest[: hits - 1]
    main_end, start = t, t
    for m in chosen:
        cut = min(plen(m), HIT_CUT[level])
        add(m, start, cut, 1.0)
        main_end = max(main_end, start + cut)
        start += min(HIT_GAP_MAX[level], max(0.45, cut * 0.6))
    payoff_start = max(0.0, main_end - 0.4)
    if (level >= 3 or set_name in KAKUTEI_EXTRA) and POOLS.get("kakutei"):
        k = pick(rng, POOLS["kakutei"], exclude=used())[0]
        cut = min(plen(k), 2.2)
        ks = max(0.0, main_end - 0.3)
        add(k, ks, cut, 0.95)
        payoff_start = ks + min(cut, 1.1)
    payoff_end = payoff_start
    if level >= 3 and POOLS["fanfare"]:
        fpool = (POOLS.get("fever", []) + POOLS["fanfare"]) if level == 4 else POOLS["fanfare"]
        f = pick(rng, fpool, exclude=used())[0]
        cut = min(plen(f), 5.0 if level == 3 else 7.0)
        add(f, payoff_start, cut, 0.9)
        payoff_end = max(payoff_end, payoff_start + cut)
        if level == 4 and POOLS["epic"]:
            e = pick(rng, POOLS["epic"], exclude=used())[0]
            cut2 = min(plen(e), 6.0)
            add(e, payoff_start + 0.3, cut2, 0.55)
            payoff_end = max(payoff_end, payoff_start + 0.3 + cut2)
    elif level == 2 and POOLS["win_mid"]:
        w = pick(rng, POOLS["win_mid"], exclude=used())[0]
        cut = min(plen(w), 3.5)
        add(w, payoff_start, cut, 0.9)
        payoff_end = max(payoff_end, payoff_start + cut)
    elif POOLS["win_small"]:
        w = pick(rng, POOLS["win_small"], exclude=used())[0]
        cut = min(plen(w), 2.0)
        add(w, payoff_start, cut, 0.8)
        payoff_end = max(payoff_end, payoff_start + cut)
    if set_name in ("hit", "jackpot", "casino", "bulk-FANTASTIC", "bulk-MIRACLE", "tier-T4") and POOLS["siren"]:
        s = pick(rng, POOLS["siren"], exclude=used())[0]
        cut = min(plen(s), 4.0)
        add(s, payoff_start + 0.2, cut, 0.5)
        payoff_end = max(payoff_end, payoff_start + 0.2 + cut)
    if level >= 3 and POOLS["cheer"]:
        c = pick(rng, POOLS["cheer"], exclude=used())[0]
        cut = min(plen(c), 5.0 if level == 3 else 7.0)
        add(c, payoff_start + 0.4, cut, 0.55)
        payoff_end = max(payoff_end, payoff_start + 0.4 + cut)
    if level >= 4 and POOLS["fireworks"] and not set_name.startswith("fireworks"):
        for i, f in enumerate(pick(rng, POOLS["fireworks"], 2, exclude=used())):
            cut = min(plen(f), 3.0)
            add(f, payoff_start + 1.0 + i * 1.4, cut, 0.6)
            payoff_end = max(payoff_end, payoff_start + 1.0 + i * 1.4 + cut)
    if level >= 2 and POOLS["coins"]:
        for i, c in enumerate(pick(rng, POOLS["coins"], 3 if level >= 3 else 2, exclude=used())):
            cut = min(plen(c), 1.5)
            add(c, payoff_start + 0.15 + i * 0.5, cut, 0.55)
    if POOLS["sparkle"]:
        sp = pick(rng, POOLS["sparkle"], exclude=used())[0]
        cut = min(plen(sp), 3.0)
        add(sp, payoff_start + 0.1, cut, 0.55)
        payoff_end = max(payoff_end, payoff_start + 0.1 + cut)
    fill_pools = ["sparkle", "win_small"] if level == 1 else (["sparkle", "coins", "win_small"] if level == 2 else ["cheer", "sparkle", "fireworks"])
    fills = 0
    while payoff_end + 0.3 < 0.8 * target and fills < 4:
        cand = pick(rng, POOLS.get(fill_pools[fills % len(fill_pools)]) or [], exclude=used())
        fills += 1
        if not cand:
            continue
        st = max(0.0, payoff_end - 0.2)
        cut = min(plen(cand[0]), max(0.6, target - st))
        add(cand[0], st, cut, 0.6)
        payoff_end = max(payoff_end, st + cut)
    return parts, min(MAX_SEC, target, payoff_end + 0.3)


TARGET_LUFS = -14.0
LIMIT = float(os.environ.get("MIX_LIMIT", "0.7"))


def render_mix(parts, total, dst, target_lufs=None):
    target_lufs = TARGET_LUFS if target_lufs is None else target_lufs
    inputs, filters, labels = [], [], []
    for i, (it, start, cut, gain) in enumerate(parts):
        fn = fetch(it)
        lead, _tail = audible(fn)
        inputs += ["-i", fn]
        ms = int(start * 1000)
        g = gain * norm_gain(fn)
        filters.append(f"[{i}:a]aformat=sample_rates=48000:channel_layouts=mono,atrim=start={lead:.3f}:end={lead + cut:.3f},asetpts=PTS-STARTPTS,afade=t=out:st={max(0.0, cut - 0.25):.2f}:d=0.25,volume={g:.3f},adelay={ms}|{ms}[a{i}]")
        labels.append(f"[a{i}]")
    fade_st = max(0.0, total - 0.8)
    filters.append("".join(labels) + f"amix=inputs={len(parts)}:normalize=0:dropout_transition=0,atrim=0:{total:.2f},afade=t=out:st={fade_st:.2f}:d=0.8[out]")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    tmp_wav = os.path.join(TMPD, "mix.wav")
    r = run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", ";".join(filters), "-map", "[out]", "-ar", "48000", "-ac", "1", "-c:a", "pcm_f32le", tmp_wav])
    if r.returncode != 0:
        raise RuntimeError(r.stderr[-400:])
    measured = measure_lufs(tmp_wav) or target_lufs
    gain_db = max(-20.0, min(20.0, target_lufs - measured))
    tmp_mp3 = os.path.join(TMPD, "mix.mp3")
    for _ in range(3):
        r = run(["ffmpeg", "-y", "-v", "error", "-i", tmp_wav, "-af", f"volume={gain_db:.2f}dB,alimiter=limit={LIMIT}:attack=3:release=60:level=disabled", "-ar", "44100", "-ac", "1", "-b:a", "96k", tmp_mp3])
        if r.returncode != 0:
            raise RuntimeError(r.stderr[-400:])
        got = measure_lufs(tmp_mp3) or target_lufs
        if got >= target_lufs - 1.5 or gain_db >= 20.0:
            break
        gain_db = min(20.0, gain_db + min(4.0, target_lufs - 0.5 - got))
    shutil.move(tmp_mp3, dst)
    return probe(dst)


def render_single(it, dst, cut_max, target_lufs, short_peak_db, limit=0.5):
    fn = fetch(it)
    lead, tail = audible(fn)
    cut = min(tail - lead, cut_max)
    fade = min(0.2, cut * 0.3)
    tmp = os.path.join(TMPD, "single.wav")
    af = f"aformat=sample_rates=48000:channel_layouts=mono,atrim=start={lead:.3f}:end={lead + cut:.3f},asetpts=PTS-STARTPTS,afade=t=in:d=0.005,afade=t=out:st={max(0.0, cut - fade):.3f}:d={fade:.3f}"
    r = run(["ffmpeg", "-y", "-v", "error", "-i", fn, "-af", af, "-ar", "48000", "-ac", "1", "-c:a", "pcm_f32le", tmp])
    if r.returncode != 0:
        raise RuntimeError(r.stderr[-300:])
    lufs = measure_lufs(tmp)
    gain_db = (target_lufs - lufs) if lufs is not None else (short_peak_db - max_db(tmp))
    gain_db = max(-24.0, min(20.0, gain_db))
    tmp_mp3 = os.path.join(TMPD, "single.mp3")
    r = run(["ffmpeg", "-y", "-v", "error", "-i", tmp, "-af", f"volume={gain_db:.2f}dB,alimiter=limit={limit}:attack=2:release=40:level=disabled", "-ar", "44100", "-ac", "1", "-b:a", "96k", tmp_mp3])
    if r.returncode != 0:
        raise RuntimeError(r.stderr[-300:])
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.move(tmp_mp3, dst)
    return probe(dst)


def comp_of(it, at=0.0):
    return {"id": it["id"], "title": it["title"], "source": it["source"], "author": it.get("author", ""), "license": it["license"], "page": it["page"], "at": round(at, 2)}


# ---------------------------------------------------------------------------
# 無料アイテムの単発音（lite-* / tier-T0 / lite-hit）と公式既定の差し替え音
# ---------------------------------------------------------------------------
LITE_THEMES = ["pop", "cute", "sparkle", "heart", "balloon", "coin", "bell", "flower", "food", "drink", "dice", "cat", "dog", "pig", "cow", "bird",
               "christmas", "sea", "fireworks", "fanfare", "trophy", "win", "jackpot", "casino", "cheer", "wow", "magic", "elephant", "monkey", "horse",
               "wolf", "lion", "bear", "kids", "party", "music", "halloween", "rocket", "explosion", "thunder", "fire", "laser", "battle", "vehicle",
               "epic", "whoosh", "notify"]
SINGLE_EXTRA = {
    # tier-T0（テーマなしの無料）と lite-hit（無料の当たり）
    "tier-T0": (["pop", "bubble pop"], 2, ["error"], r"interface-sounds/(select|drop|pluck)|ui-audio/click", ["pop", "bubble"]),
    "lite-hit": (["correct answer ding", "success jingle short", "level up"], 3, ["fail", "lose", "wrong"], r"music-jingles/jingles_(NES|PIZZI)|interface-sounds/confirmation", ["correct", "success", "level"]),
}
DEFAULT_SPECS = {
    # 公式既定（社長の割り当てを他の利用者に配る分）の差し替え音: 名前 → (検索語, 最大秒, 除く語, Kenney, 好む語)
    "drumroll": (["drum roll", "snare roll"], 5, ["fail"], None, ["drum", "roll"]),
    "elephant": (["elephant trumpet", "elephant"], 4, ["robot", "fake"], None, ["elephant"]),
    "dog_bark": (["dog bark", "dog barking"], 3, ["growl", "angry"], None, ["bark", "dog"]),
    "pig_oink": (["pig oink", "pig grunt"], 3, ["scream"], None, ["oink", "pig"]),
    "fireworks": (["fireworks", "firework explosion"], 5, ["ambience"], None, ["firework"]),
    "air_horn": (["air horn", "party horn"], 3, ["truck", "ship"], None, ["air horn", "horn"]),
    "cat_meow": (["cat meow", "kitten meow"], 3, ["angry", "hiss"], None, ["meow"]),
    "mouse_squeak": (["mouse squeak", "rat squeak", "squeak"], 2, ["door", "shoe"], None, ["mouse", "squeak"]),
    "bird_song": (["bird song", "songbird", "bird chirp"], 4, ["ambience", "crow"], None, ["bird", "song", "chirp"]),
    "sparkle_shing": (["sword shing", "metal shing", "sparkle twinkle"], 3, ["gore"], r"digital-audio/powerUp", ["shing", "sparkle"]),
    "jackpot_alert": (["slot machine win", "jackpot"], 4, ["fail", "lose"], r"digital-audio/threeTone", ["jackpot", "slot", "win"]),
    "slot_clunk": (["slot machine lever", "slot machine reel stop", "lever pull"], 3, [], r"impact-sounds/impactMetal_heavy", ["slot", "lever", "reel"]),
    "dance_jingle": ([], 5, [], r"music-jingles/jingles_(SAX|STEEL)", []),
    "star_jingle": ([], 5, [], r"music-jingles/jingles_NES", []),
    "summon_magic": (["magic spell", "summon magic", "spell cast"], 4, ["dark", "evil"], r"digital-audio/phaserUp", ["magic", "spell", "summon"]),
    "deer_call": (["deer call", "deer bleat", "fawn"], 3, ["hunting"], r"digital-audio/pepSound", ["deer", "fawn"]),
}
DEFAULT_SINGLE_EXTRA = {"chime": (["chime notification", "bell ding"], 3, ["alarm", "error"], r"interface-sounds/confirmation", ["chime", "ding"])}


def candidates_for(spec, n=8):
    qs, maxsec, ban, krx, prefer = spec
    fs = fs_many(qs, maxsec, ban, limit=16) if qs else []
    scored = []
    for rank, it in enumerate(fs):
        t = it["title"].lower()
        scored.append((sum(3 for p in prefer if p in t) + min(3, (it.get("downloads") or 0) / 3000) - rank * 0.1, it))
    if krx:
        for it in kenney_match(krx):
            scored.append((2.0, it))
    scored.sort(key=lambda x: -x[0])
    return [it for _, it in scored][:n]


def build_singles(manifest, only):
    for out_name, ids in PICKS.LITE_PICKS.items():
        if only and out_name not in only:
            continue
        target = -18.0 if out_name == "lite-hit" else -19.0
        rows = []
        for k, sid in enumerate(ids, start=1):
            it = resolve(sid)
            dst = os.path.join(OUT, out_name, f"{PREFIX}{k}.mp3")
            d = render_single(it, dst, 1.5, target, -8.0)
            rows.append({"id": f"{PREFIX}{k}", "file": f"/se/lib/{out_name}/{PREFIX}{k}.mp3", "title": f"{out_name} 単発 {k}（{it['title'][:28]}・{d:.1f}s）", "seconds": round(d or 0, 2), "bytes": os.path.getsize(dst), "components": [comp_of(it)]})
        manifest["themes"][out_name] = rows
        print(f"{out_name}: {len(rows)} 本 " + " / ".join(f"{r['components'][0]['id']}({r['seconds']}s)" for r in rows), flush=True)


def build_mixes(manifest, only):
    build_pools()
    for set_name in PICKS.THEME_PICKS:
        if only and set_name not in only:
            continue
        mains = theme_mains(set_name)
        if len(mains) < 2:
            print(f"WARN {set_name}: テーマ音が {len(mains)} 本しか無い", file=sys.stderr)
        rows = []
        for v in range(5):
            rng = random.Random(f"v7:{set_name}#{v}")
            try:
                parts, total = compose(set_name, v, mains, rng)
                dst = os.path.join(OUT, set_name, f"{PREFIX}{v + 1}.mp3")
                d = render_mix(parts, total, dst)
                rows.append({"id": f"{PREFIX}{v + 1}", "file": f"/se/lib/{set_name}/{PREFIX}{v + 1}.mp3", "title": f"{set_name} ミックス {v + 1}（{len(parts)} 素材・{d:.1f}s）", "seconds": round(d or 0, 2), "bytes": os.path.getsize(dst), "components": [comp_of(p[0], p[1]) for p in parts]})
            except Exception as e:
                print(f"WARN {set_name} {PREFIX}{v + 1}: {e}", file=sys.stderr)
        manifest["themes"][set_name] = rows
        print(f"{set_name}: {len(rows)} 本 " + " / ".join(f"{r['seconds']}s({len(r['components'])})" for r in rows), flush=True)


def build_defaults(only):
    """公式既定の差し替え音（public/se/defaults/cc0/<名前>.mp3・-16 LUFS・最大 3.5 秒）。出典は defaults.json の components"""
    path = os.path.join(DEF_OUT, "defaults.json")
    meta = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {"sounds": {}}
    for name, ids in PICKS.DEFAULT_PICKS.items():
        if only and name not in only:
            continue
        items = [resolve(x) for x in ids]
        cut_max = PICKS.DEFAULT_CUT.get(name, 3.5)
        dst = os.path.join(DEF_OUT, f"{name}.mp3")
        if len(items) == 1:
            d = render_single(items[0], dst, cut_max, -16.0, -6.0, limit=0.7)
            comps = [comp_of(items[0])]
        else:
            parts, t = [], 0.0
            for it in items:
                cut = min(plen(it), cut_max)
                parts.append((it, t, cut, 1.0))
                t += max(0.3, cut * 0.8)
            total = min(cut_max + 1.0, max(p[1] + p[2] for p in parts))
            d = render_mix(parts, total, dst, target_lufs=-16.0)
            comps = [comp_of(p[0], p[1]) for p in parts]
        meta["sounds"][name] = {"file": f"/se/defaults/cc0/{name}.mp3", "seconds": round(d or 0, 2), "bytes": os.path.getsize(dst), "components": comps}
        print(f"default {name}: " + " + ".join(f"{c['id']} {c['title'][:30]}" for c in comps) + f" ({d:.1f}s)", flush=True)
    meta["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    meta["license"] = "すべて CC0 1.0（Freesound の CC0 フィルタ / Kenney）。社長の割り当ての「どんな音か」に合わせて選んだ同種の音（src/lib/se/cleared-defaults.ts）"
    json.dump(meta, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def write_manifest(manifest):
    path = os.path.join(OUT, "manifest.json")
    used = {}
    for rows in manifest["themes"].values():
        for r in rows:
            for c in r["components"]:
                used[c["id"]] = c
    manifest["credits"] = {
        "freesound": [{"id": c["id"], "title": c["title"], "author": c["author"], "page": c["page"]} for k, c in sorted(used.items()) if c["source"] == "freesound"],
        "kenney": sorted({c["page"] for c in used.values() if c["source"] == "kenney"}),
    }
    manifest["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    json.dump(manifest, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    total = sum(r["bytes"] for rows in manifest["themes"].values() for r in rows)
    n = sum(len(v) for v in manifest["themes"].values())
    by = {}
    for c in used.values():
        by[c["source"]] = by.get(c["source"], 0) + 1
    print(f"sets {len(manifest['themes'])} files {n} total {total / 1024 / 1024:.1f} MB materials {by}")


def write_catalog():
    """選曲表の全 id の取得先を cc0_catalog.json に書く（Freesound: HQ プレビューの URL・タイトル・作者・ページ / Kenney: パックとファイル）"""
    global _CATALOG
    _CATALOG = {}
    ids = sorted({x for tbl in (PICKS.POOL_PICKS, PICKS.THEME_PICKS, PICKS.LITE_PICKS, PICKS.DEFAULT_PICKS) for v in tbl.values() for x in v})
    items = {}
    for sid in ids:
        it = resolve(sid)
        if it["source"] == "freesound":
            items[sid] = {"source": "freesound", "url": it["url"], "title": it["title"], "author": it["author"], "license": "CC0 1.0", "page": it["page"]}
        else:
            pack = it["page"].rstrip("/").split("/")[-1]
            rel = os.path.relpath(it["path"], os.path.join(KENNEY, pack)).replace(os.sep, "/")
            items[sid] = {"source": "kenney", "pack": pack, "file": rel, "title": it["title"], "author": "Kenney", "license": "CC0 1.0", "page": it["page"]}
    json.dump({"note": "選曲表（cc0_picks.py）の素材の取得先。build_se_cc0.py catalog で作る。すべて CC0 1.0", "items": items}, open(CATALOG, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"catalog {len(items)} 件（freesound {sum(1 for v in items.values() if v['source'] == 'freesound')}・kenney {sum(1 for v in items.values() if v['source'] == 'kenney')}）")


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    only = sys.argv[2:]
    if mode == "catalog":
        write_catalog()
        return
    path = os.path.join(OUT, "manifest.json") if OUT else ""
    if mode in ("all", "mix", "single"):
        fresh = {"style": "pachinko-mix v7（CC0 のみ: Freesound CC0 + Kenney）。ライザー→インパクト→テーマ連打→確定音→ファンファーレ/歓声/コイン/きらきら。最大 15 秒・mono 96k / 無料アイテムは単発音（1.5 秒まで・-19 LUFS）",
                 "sources": LICENSE_TEXT, "themes": {}}
        # all は一覧を作り直す（選曲表から消えたセットも落ちる）。mix / single は今の一覧を読み、作ったセットだけ差し替える
        # （mix だけ・single だけを実行しても、もう片方のセットが一覧から消えないように）
        manifest = fresh if (mode == "all" or not os.path.exists(path)) else json.load(open(path, encoding="utf-8"))
        manifest["sources"] = LICENSE_TEXT
        manifest["style"] = fresh["style"]
        if mode in ("all", "mix"):
            build_mixes(manifest, only)
        if mode in ("all", "single"):
            build_singles(manifest, only)
        write_manifest(manifest)
    if mode in ("all", "defaults"):
        os.makedirs(DEF_OUT, exist_ok=True)
        build_defaults(only)


if __name__ == "__main__":
    main()
