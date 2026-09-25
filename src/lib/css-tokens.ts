"use client";

import { useEffect, useState } from "react";

// [CSS variable name, SSR/pre-mount fallback]
export type CssTokenSpec = Record<string, readonly [string, string]>;

export function readCssToken(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function resolve<T extends CssTokenSpec>(spec: T): { [K in keyof T]: string } {
  const out = {} as { [K in keyof T]: string };
  for (const key in spec) {
    const [name, fallback] = spec[key];
    out[key] = readCssToken(name, fallback);
  }
  return out;
}

// Single source of truth for chart colors is globals.css; recharts needs raw
// values, so read the computed CSS variables once after mount.
export function useCssTokens<T extends CssTokenSpec>(spec: T): { [K in keyof T]: string } {
  const [tokens, setTokens] = useState(() => resolve(spec));
  useEffect(() => {
    setTokens(resolve(spec));
    // spec objects are module-level constants
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return tokens;
}
