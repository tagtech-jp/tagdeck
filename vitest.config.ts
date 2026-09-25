import { defineConfig } from "vitest/config";
import path from "node:path";

// tsconfig の "@/*" エイリアスを vitest でも解決する（Route Handler のテストで vi.mock("@/lib/...") を使うため）
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
  },
});
