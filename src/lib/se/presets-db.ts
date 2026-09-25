// S2: SE プリセットの DB 操作（サーバ専用）。純関数は presets.ts
import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { createDbClient } from "@/lib/db/client";
import { seMappings, sePresets, users } from "@/lib/db/schema";
import { generateShareCode, toPresetMappings, type PresetApplyMode, type SePresetMapping } from "./presets";
import { describeDbError } from "@/lib/whowatch/sanitize";

/**
 * プリセット系ルートの DB 例外を利用者向けの文言にする。
 * 本番で「保存に失敗しました（HTTP 500）」だけ出て原因が分からなかった（2026-09-26）ため、
 * テーブル未作成（migration 0018 未適用・42P01）は 503 と具体的な手順で返す。SQL 全文は出さない
 */
export function describePresetDbError(err: unknown): { status: number; error: string } {
  const summary = describeDbError(err);
  const cause = (err as { cause?: { code?: string } } | null)?.cause;
  const missingTable = cause?.code === "42P01" || /42P01|does not exist/.test(summary);
  if (missingTable) {
    return { status: 503, error: "プリセット用のテーブルがまだ作られていません。Supabase SQL Editor で drizzle/0018_se_presets_manual.sql を実行してください" };
  }
  return { status: 500, error: `保存できませんでした（${summary}）` };
}

type Db = ReturnType<typeof createDbClient>;

/** 音源 URL として許可するホスト（Supabase Storage）。未設定なら検査しない */
export function allowedSoundHost(): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  try {
    return new URL(base).host;
  } catch {
    return null;
  }
}

/** 自分の se_mappings を今の状態でスナップショットする */
export async function snapshotOwnMappings(db: Db, userId: string): Promise<SePresetMapping[]> {
  const rows = await db
    .select({ key: seMappings.key, url: seMappings.url, volume: seMappings.volume, enabled: seMappings.enabled, label: seMappings.label })
    .from(seMappings)
    .where(eq(seMappings.userId, userId));
  return toPresetMappings(rows, { allowedHost: allowedSoundHost() });
}

export interface PresetRowPublic {
  id: string;
  shareCode: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  mappingCount: number;
  ownerName: string | null;
  isMine: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toPublicPreset(r: typeof sePresets.$inferSelect, ownerName: string | null, me: string): PresetRowPublic {
  return toPublic(r, ownerName, me);
}

function toPublic(r: typeof sePresets.$inferSelect, ownerName: string | null, me: string): PresetRowPublic {
  return {
    id: r.id,
    shareCode: r.shareCode,
    name: r.name,
    description: r.description,
    isPublic: r.isPublic,
    mappingCount: r.mappingCount,
    ownerName,
    isMine: r.ownerUserId === me,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** 自分のプリセット（新しい順） */
export async function listOwnPresets(db: Db, userId: string): Promise<PresetRowPublic[]> {
  const rows = await db.select().from(sePresets).where(eq(sePresets.ownerUserId, userId)).orderBy(desc(sePresets.updatedAt));
  return rows.map((r) => toPublic(r, null, userId));
}

/** 公開プリセット（自分以外・新しい順・最大 limit 件） */
export async function listPublicPresets(db: Db, userId: string, limit = 50): Promise<PresetRowPublic[]> {
  const rows = await db
    .select({ preset: sePresets, ownerName: users.displayName })
    .from(sePresets)
    .leftJoin(users, eq(users.id, sePresets.ownerUserId))
    .where(and(eq(sePresets.isPublic, true), ne(sePresets.ownerUserId, userId)))
    .orderBy(desc(sePresets.updatedAt))
    .limit(limit);
  return rows.map((r) => toPublic(r.preset, r.ownerName, userId));
}

export async function findPresetByCode(db: Db, code: string): Promise<{ row: typeof sePresets.$inferSelect; ownerName: string | null } | null> {
  const [r] = await db
    .select({ preset: sePresets, ownerName: users.displayName })
    .from(sePresets)
    .leftJoin(users, eq(users.id, sePresets.ownerUserId))
    .where(eq(sePresets.shareCode, code))
    .limit(1);
  return r ? { row: r.preset, ownerName: r.ownerName } : null;
}

/** 共有コードの衝突は再生成で回避する（32^8 ≒ 1.1 兆通りなので実際にはまず起きない） */
export async function createPreset(
  db: Db,
  userId: string,
  input: { name: string; description: string | null; isPublic: boolean; mappings: SePresetMapping[] },
): Promise<typeof sePresets.$inferSelect> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const shareCode = generateShareCode();
    try {
      const [row] = await db
        .insert(sePresets)
        .values({ ownerUserId: userId, name: input.name, description: input.description, shareCode, isPublic: input.isPublic, mappings: input.mappings, mappingCount: input.mappings.length })
        .returning();
      return row;
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!/share_code|unique|duplicate/i.test(msg)) throw e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("share code collision");
}

/**
 * プリセットを自分の se_mappings に適用する。
 * replace: 自分の割り当てを全部消してから入れる / merge: 同じ key は上書き、無い key は残す。
 * 1 トランザクション・1 INSERT（行数ぶんのループを回さない）
 */
export async function applyPresetToUser(db: Db, userId: string, mappings: SePresetMapping[], mode: PresetApplyMode): Promise<{ applied: number; removed: number }> {
  const now = new Date();
  return db.transaction(async (tx) => {
    let removed = 0;
    if (mode === "replace") {
      const deleted = await tx.delete(seMappings).where(eq(seMappings.userId, userId)).returning({ id: seMappings.id });
      removed = deleted.length;
    }
    if (mappings.length === 0) return { applied: 0, removed };
    await tx
      .insert(seMappings)
      .values(mappings.map((m) => ({ userId, key: m.key, url: m.url, volume: m.volume, enabled: m.enabled, label: m.label, updatedAt: now })))
      .onConflictDoUpdate({
        target: [seMappings.userId, seMappings.key],
        set: { url: sql`excluded.url`, volume: sql`excluded.volume`, enabled: sql`excluded.enabled`, label: sql`excluded.label`, updatedAt: now },
      });
    return { applied: mappings.length, removed };
  });
}
