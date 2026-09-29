// 正式リリースの音源ルールの検査（2026-09-30 社長指示「正式にリリースする手順にしたいので、著作権のあるものは弾いて別の音源に差し替えて」・S23）。
// アプリが配る音源（public/se/ 以下）は、すべて出典とライセンス（CC0 1.0）の記録があるものだけにする。
//   - 自動ライブラリ: public/se/lib/manifest.json の components
//   - 公式既定: public/se/defaults/cc0/defaults.json の components
// 記録の無い音源ファイルを置いたり、CC0 以外の素材を混ぜたりすると、このテストが落ちる（CI で止まる）。
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AUTO_LIBRARY } from "./auto-library-data";
import { CLEARED_SOUND_IDS, clearedSoundUrl } from "./cleared-defaults";
import { DEFAULT_SE_MAPPINGS, GENERIC_DEFAULT_SOUND } from "./default-mappings";

const PUBLIC = path.resolve(__dirname, "../../../public");
const AUDIO_RE = /\.(mp3|wav|ogg|m4a|aac|flac|webm|opus)$/i;
const ALLOWED_SOURCES = new Set(["freesound", "kenney"]);
const PAGE_RE = /^https:\/\/(freesound\.org\/people\/[^/]+\/sounds\/\d+\/|kenney\.nl\/assets\/[a-z0-9-]+)$/;
// CC0 でも持ち込み（他人の作品の録音）が疑われる名前
const IP_RE = /mario|nintendo|任天堂|zelda|pok[eé]mon|sonic|sega|capcom|konami|star ?wars|disney|pixar|minecraft|牙狼|ジャグラー|juggler|pachinko|pachislot|パチンコ|パチスロ|anime|アニメ|ripped|soundtrack/i;

interface Component {
  id: string;
  title: string;
  source: string;
  author?: string;
  license: string;
  page: string;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const toUrl = (abs: string) => "/" + path.relative(PUBLIC, abs).split(path.sep).join("/");

const manifest = JSON.parse(readFileSync(path.join(PUBLIC, "se/lib/manifest.json"), "utf-8")) as {
  themes: Record<string, Array<{ file: string; components: Component[] }>>;
};
const defaults = JSON.parse(readFileSync(path.join(PUBLIC, "se/defaults/cc0/defaults.json"), "utf-8")) as {
  sounds: Record<string, { file: string; components: Component[] }>;
};

const registered = new Map<string, Component[]>();
for (const rows of Object.values(manifest.themes)) for (const r of rows) registered.set(r.file, r.components);
for (const s of Object.values(defaults.sounds)) registered.set(s.file, s.components);

describe("配る音源はすべて CC0 の記録があるものだけ（S23）", () => {
  const audioFiles = walk(path.join(PUBLIC, "se")).filter((p) => AUDIO_RE.test(p)).map(toUrl);

  it("public/se/ の音源ファイルはすべて出典の記録がある（記録の無いファイルを置かない）", () => {
    expect(audioFiles.length).toBeGreaterThan(0);
    const unregistered = audioFiles.filter((f) => !registered.has(f));
    expect(unregistered).toEqual([]);
  });

  it("記録されたファイルはすべて実在する", () => {
    const onDisk = new Set(audioFiles);
    const missing = [...registered.keys()].filter((f) => !onDisk.has(f));
    expect(missing).toEqual([]);
  });

  it("素材はすべて CC0 1.0（Freesound の CC0 / Kenney）で、ページの URL がある", () => {
    for (const [file, comps] of registered) {
      expect(comps.length, file).toBeGreaterThan(0);
      for (const c of comps) {
        expect(ALLOWED_SOURCES.has(c.source), `${file} ${c.id} ${c.source}`).toBe(true);
        expect(c.license, `${file} ${c.id}`).toBe("CC0 1.0");
        expect(c.page, `${file} ${c.id}`).toMatch(PAGE_RE);
      }
    }
  });

  it("ゲーム・アニメ・パチンコ・企業名などが付いた素材を使っていない", () => {
    for (const [file, comps] of registered) for (const c of comps) expect(`${c.title} ${c.author ?? ""}`, `${file} ${c.id}`).not.toMatch(IP_RE);
  });
});

describe("コードが参照する音源は記録済みのファイルだけ", () => {
  it("自動ライブラリ（AUTO_LIBRARY）のファイルは manifest と 1 対 1", () => {
    const files = Object.values(AUTO_LIBRARY).flatMap((rows) => rows.map((r) => r.file));
    for (const f of files) expect(registered.has(f), f).toBe(true);
    const manifestFiles = Object.values(manifest.themes).flatMap((rows) => rows.map((r) => r.file));
    expect(new Set(files)).toEqual(new Set(manifestFiles));
  });

  it("公式既定（CLEARED_SOUNDS・同梱スナップショット・汎用）の音は defaults.json に記録がある", () => {
    for (const id of CLEARED_SOUND_IDS) expect(registered.has(clearedSoundUrl(id)), id).toBe(true);
    for (const d of DEFAULT_SE_MAPPINGS) expect(registered.has(d.url), d.key).toBe(true);
    expect(registered.has(GENERIC_DEFAULT_SOUND.url)).toBe(true);
  });
});
