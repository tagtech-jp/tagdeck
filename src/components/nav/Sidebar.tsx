"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Trophy, Radio, Sparkles, Settings } from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "ホーム", icon: Home },
  { href: "/events", label: "イベント", icon: Trophy },
  { href: "/live", label: "ライブ", icon: Radio },
  { href: "/ai-prompter", label: "攻略", icon: Sparkles },
  { href: "/settings", label: "設定", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="hidden w-48 shrink-0 flex-col border-r border-border bg-card p-3 md:flex">
      <div className="space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              <Icon className="size-4" />
              <span className="text-sm">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
