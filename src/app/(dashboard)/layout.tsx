import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { Sidebar } from "@/components/nav/Sidebar";
import { BottomTabBar } from "@/components/nav/BottomTabBar";
import { PlatformSwitcher } from "@/components/dashboard/PlatformSwitcher";
import { Providers } from "./providers";
import { LiveStatusIndicator } from "@/components/live/LiveStatusIndicator";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <Providers>
      <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-background px-4 py-3">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold">TagDeck</h1>
          <PlatformSwitcher />
        </div>
        <div className="flex items-center gap-1">
          <LiveStatusIndicator />
          <form action="/auth/signout" method="post">
            {/* SP: icon only (text wrapped vertically at 390px); md+: text */}
            <button
              type="submit"
              aria-label="ログアウト"
              className="flex min-h-11 min-w-11 items-center justify-center rounded-full px-3 text-sm text-muted-foreground hover:text-foreground"
            >
              <LogOut className="size-5 md:hidden" aria-hidden="true" />
              <span className="hidden md:inline">ログアウト</span>
            </button>
          </form>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-auto pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </main>
      </div>
        <BottomTabBar />
      </div>
    </Providers>
  );
}
