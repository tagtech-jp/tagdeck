import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// SE 音源のアップロード（サーバ経由）。
// 2026-09-25: ブラウザ側の Supabase クライアントで直接 Storage に上げていたが、Service Worker が
// 古い JS（Supabase URL が違う版）を配っている間は auth.getUser() が null になり「ログインが必要です」と
// 出てしまった。サーバ側はデプロイ直後から新しい版で動くので、認証もアップロードもサーバで行う。
// 認証は Cookie（他の API ルートと同じ）。Storage の RLS は auth.uid() 配下のパスだけ書けるので、
// パスの先頭は必ず user.id にする（0014 の "se: own write" ポリシー）。

const MAX_BYTES = 5 * 1024 * 1024;
const KEY_RE = /^(pattern:\d{1,10}|item:\d{1,10}|cat:kind:(normal|hit|anim)|cat:group:[A-Za-z0-9_#-]{1,64}|tier:(T0|T1|T2|T3|T4|hit))$/;
const EXT_RE = /\.(mp3|ogg|wav)$/i;
const CONTENT_TYPES: Record<string, string> = { mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav" };

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const key = String(form?.get("key") ?? "");
  if (!(file instanceof File)) return NextResponse.json({ error: "file が必要です" }, { status: 400 });
  if (!KEY_RE.test(key)) return NextResponse.json({ error: "key が不正です" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "5MB 以下のファイルにしてください" }, { status: 400 });
  if (!EXT_RE.test(file.name)) return NextResponse.json({ error: "mp3 / ogg / wav のみ対応です" }, { status: 400 });

  const ext = file.name.split(".").pop()!.toLowerCase();
  // key の ":" と "#" はパスに使わない（"cat:group:stage_up_pack#ouen-buta" のような key がある）
  const safeKey = key.replace(/[^A-Za-z0-9_-]/g, "_");
  const path = `${user.id}/${safeKey}_${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("se").upload(path, file, { upsert: true, contentType: file.type || CONTENT_TYPES[ext] });
  if (error) return NextResponse.json({ error: `アップロード失敗: ${error.message}（バケット se の作成と 0014 の適用を確認）` }, { status: 502 });

  const { data } = supabase.storage.from("se").getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl, label: file.name, path });
}
