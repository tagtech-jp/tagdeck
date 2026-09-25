"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Trophy, Radio, Settings } from "lucide-react";

const TABS = [
  { href: "/dashboard", label: "ホーム", icon: Home },
  { href: "/events", label: "イベント", icon: Trophy },
  { href: "/live", label: "ライブ", icon: Radio },
  { href: "/settings", label: "設定", icon: Settings },
];

export function BottomTabBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="grid grid-cols-4">
        {TABS.map((tab) => {
          const isActive = pathname.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex min-h-11 flex-col items-center justify-center gap-0.5 py-2 transition-colors ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <Icon className="size-5" strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-xs">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
