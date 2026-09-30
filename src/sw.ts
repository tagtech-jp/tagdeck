import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { ExpirationPlugin, NetworkFirst, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const self: any;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // 公式既定の音（public/se/defaults/）は同じ URL のまま中身を差し替えることがある（2026-09-30 きらめきのジングルを差し替え・S25）。
  // 既定の runtimeCaching は音源を CacheFirst（最後に使ってから 24 時間）で持つので、差し替え前の音が鳴り続けないよう
  // ここだけネットワークを先に見る（オフラインや遅いときはキャッシュ）。自動ライブラリ（/se/lib/）は作り直すたびに別名（v8-* 等）なので既定のまま
  runtimeCaching: [
    {
      matcher: ({ url }: { url: URL }) => url.pathname.startsWith("/se/defaults/"),
      handler: new NetworkFirst({
        cacheName: "se-default-sounds",
        networkTimeoutSeconds: 3,
        plugins: [new ExpirationPlugin({ maxEntries: 40, maxAgeSeconds: 7 * 24 * 60 * 60 })],
      }),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();
