import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Cloudflare Workers の I/O 制約：グローバルに保持禁止
// Route Handler・Server Action 内で都度呼び出すこと
export function createDbClient() {
  const client = postgres(process.env.DATABASE_URL!, {
    prepare: false, // Supabase のトランザクションプーラー対応
  });
  return drizzle(client);
}
