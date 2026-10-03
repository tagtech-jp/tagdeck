"use client";

import { useEffect } from "react";
import { refreshSessionIfNeeded, SESSION_CHECK_MS } from "@/lib/auth/session-refresh";

/**
 * ログインを切らさない見張り役（画面には何も出さない）。ログイン後の画面全体（(dashboard) の Providers）に 1 つ置く。
 * 理由と仕組みは src/lib/auth/session-refresh.ts
 */
export function SessionKeeper() {
  useEffect(() => {
    let busy = false;
    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        await refreshSessionIfNeeded();
      } finally {
        busy = false;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    void check();
    const timer = setInterval(() => void check(), SESSION_CHECK_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, []);
  return null;
}
