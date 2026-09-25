"use client";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useState } from "react";

type Provider = "google" | "twitter" | "discord";

const providers: { id: Provider; label: string; icon: string }[] = [
  { id: "google", label: "Google でログイン", icon: "G" },
  { id: "twitter", label: "X (Twitter) でログイン", icon: "𝕏" },
  { id: "discord", label: "Discord でログイン", icon: "D" },
];

export function OAuthButtons() {
  const supabase = createClient();
  const [loading, setLoading] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleOAuth = async (provider: Provider) => {
    setLoading(provider);
    setError(null);

    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      console.error(error);
      setError(`${provider} でのログインに失敗しました：${error.message}`);
      setLoading(null);
    }
  };

  return (
    <div className="space-y-2">
      {providers.map((p) => (
        <Button
          key={p.id}
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => handleOAuth(p.id)}
          disabled={loading !== null}
        >
          <span className="mr-2 font-bold">{p.icon}</span>
          {loading === p.id ? "接続中..." : p.label}
        </Button>
      ))}
      {error && (
        <p className="text-center text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
