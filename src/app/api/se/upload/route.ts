import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// SE 音源のアップロード（サーバ経由）。
// 2026-09-25: ブラウザ側の Supabase クライアントで直接 Storage に上げていたが、Service Worker が
// 古い JS（Supabase URL が違う版）を配っている間は auth.getUser() が null になり「ログインが必要です」と
// 出てしまった。サーバ側はデプロイ直後から新しい版で動くので、認証もアップロードもサーバで行う。
// 認証は Cookie（他の API ルートと同じ）。Storage の RLS は auth.uid() 配下のパスだけ書けるので、
// パスの先頭は必ず user.id にする（0014 の "se: own write" ポリシー）。

// 2026-09-26: 5MB → 20MB（WAV は 30 秒で 5MB を超える）。m4a / aac も受け付ける（Web Audio の decodeAudioData が再生できる）。
// バケット側の上限・MIME は drizzle/0019_se_bucket_limits_manual.sql で合わせる（未適用だと 5MB 超・m4a は Supabase 側で拒否される）
const MAX_BYTES = 20 * 1024 * 1024;
const KEY_RE = /^(pattern:\d{1,10}|item:\d{1,10}|cat:kind:(normal|hit|anim)|cat:group:[A-Za-z0-9_#-]{1,64}|tier:(T0|T1|T2|T3|T4|hit))$/;
const EXT_RE = /\.(mp3|ogg|wav|m4a|aac)$/i;
const CONTENT_TYPES: Record<string, string> = { mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac" };

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const key = String(form?.get("key") ?? "");
  if (!(file instanceof File)) return NextResponse.json({ error: "file が必要です" }, { status: 400 });
  if (!KEY_RE.test(key)) return NextResponse.json({ error: "key が不正です" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: `20MB 以下のファイルにしてください（${(file.size / 1024 / 1024).toFixed(1)}MB）` }, { status: 400 });
  if (!EXT_RE.test(file.name)) return NextResponse.json({ error: `mp3 / ogg / wav / m4a / aac のみ対応です（${file.name}）` }, { status: 400 });

  const ext = file.name.split(".").pop()!.toLowerCase();
  // key の ":" と "#" はパスに使わない（"cat:group:stage_up_pack#ouen-buta" のような key がある）
  const safeKey = key.replace(/[^A-Za-z0-9_-]/g, "_");
  const path = `${user.id}/${safeKey}_${Date.now()}.${ext}`;
  // Content-Type はブラウザ申告（audio/x-wav・空文字・video/mp4 など揺れる）を使わず、拡張子から正規の値にする
  const { error } = await supabase.storage.from("se").upload(path, file, { upsert: true, contentType: CONTENT_TYPES[ext] });
  if (error) {
    const m = error.message;
    const hint = /exceeded the maximum allowed size|too large|Payload too large/i.test(m)
      ? "ストレージ側の上限（5MB）を超えています。drizzle/0019_se_bucket_limits_manual.sql を Supabase で適用すると 20MB まで受け付けます"
      : /mime type|not supported/i.test(m)
        ? "ストレージ側で許可されていない形式です。drizzle/0019_se_bucket_limits_manual.sql を Supabase で適用してください"
        : "バケット se の作成と 0014 の適用を確認";
    return NextResponse.json({ error: `アップロード失敗: ${m}（${hint}）` }, { status: 502 });
  }

  const { data } = supabase.storage.from("se").getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl, label: file.name, path });
}
