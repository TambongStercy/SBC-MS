import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { CommandPalette } from './CommandPalette';
import { Header } from './Header';
import { BottomBar, MobileMenu } from './MobileNav';
import { Sidebar } from './Sidebar';

const SIDEBAR_KEY = 'sbc-support-sidebar-open';

function readSidebarOpen(): boolean {
  try { return localStorage.getItem(SIDEBAR_KEY) !== '0'; } catch { return true; }
}

/**
 * The signed-in agent's frame (same layout as the admin):
 * - computer (md+): collapsible sidebar, top bar, content;
 * - phone: top bar with the menu button, content, bottom bar of shortcuts.
 * The page never scrolls; the content area does.
 */
export function AppShell() {
  const { pathname } = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarOpen);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLElement>(null);

  const toggleSidebar = () => {
    setSidebarOpen(open => {
      try { localStorage.setItem(SIDEBAR_KEY, open ? '0' : '1'); } catch { /* not remembered */ }
      return !open;
    });
  };

  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: 0, left: 0 });
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 48rem)');
    const onChange = () => { if (mq.matches) setMobileMenuOpen(false); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-fg">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[400] focus:rounded-control focus:bg-surface focus:px-3 focus:py-2">
        Aller au contenu
      </a>
      <Sidebar open={sidebarOpen} onToggle={toggleSidebar} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header onOpenMobileMenu={() => setMobileMenuOpen(true)} />
        <main ref={scrollRef} id="main" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="w-full min-w-0 px-4 py-4 md:px-6 md:py-6">
            <Outlet />
          </div>
        </main>
        <BottomBar onOpenMenu={() => setMobileMenuOpen(true)} menuOpen={mobileMenuOpen} />
      </div>
      <MobileMenu open={mobileMenuOpen} onOpenChange={setMobileMenuOpen} />
      <CommandPalette />
    </div>
  );
}
