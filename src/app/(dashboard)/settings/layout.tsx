"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// R9 迷2対策: 「プラットフォーム連携」を最上段(先頭)に昇格。
const SETTINGS_NAV = [
  { href: "/settings/platforms", label: "プラットフォーム連携" },
  { href: "/settings", label: "プロファイル" },
  { href: "/settings/notifications", label: "通知" },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-4 p-4 md:h-[calc(100vh-65px)] md:flex-row">
      <nav className="shrink-0 md:w-48">
        <h2 className="mb-4 text-xl font-bold text-foreground">設定</h2>
        <div className="flex gap-1 overflow-x-auto md:flex-col">
          {SETTINGS_NAV.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`min-h-11 shrink-0 whitespace-nowrap rounded-full px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
