// YouTube Live Chat OAuth 中継サーバー
// Phase 3a-2 で OAuth + YouTube Live Chat API ポーリングを実装予定
// 設計参照: docs/migration/phase3_plan_v1.0.md §7.1 / §7.2

import http from "node:http";

const PORT = Number(process.env.PORT ?? 10000);

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "youtube-relay" }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`[youtube-relay] listening on port ${PORT}`);
});

process.on("SIGTERM", () => {
  console.log("[youtube-relay] SIGTERM received, shutting down");
  server.close(() => process.exit(0));
});
