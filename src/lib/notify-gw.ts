// notify-gw（通知ゲートウェイ兼証跡層）への送信。POST /event、X-Run-Key。
// env NOTIFY_GW_KEY が無ければ何もしない（ローカル・未設定環境で落とさない）。本文は UTF-8 JSON。

export interface NotifyGwEvent {
  agent_id: string;
  action: string;
  severity: "CRITICAL" | "WARN" | "INFO";
  result?: "success" | "failure" | "skip";
  target?: string;
  summary?: string;
  fingerprint?: string;
  meta?: Record<string, unknown>;
}

export const NOTIFY_GW_DEFAULT_URL = "https://notify-gw.bb25xp.workers.dev";

export async function sendNotifyGw(ev: NotifyGwEvent): Promise<{ sent: boolean; status?: number }> {
  const key = process.env.NOTIFY_GW_KEY;
  if (!key) return { sent: false };
  const base = (process.env.NOTIFY_GW_URL ?? NOTIFY_GW_DEFAULT_URL).replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", "X-Run-Key": key },
      body: JSON.stringify(ev),
      signal: AbortSignal.timeout(8000),
    });
    return { sent: res.ok, status: res.status };
  } catch (e) {
    console.warn("[notify-gw] send failed", e);
    return { sent: false };
  }
}
