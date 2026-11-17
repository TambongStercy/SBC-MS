import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { CommandPalette } from './CommandPalette';
import { Header } from './Header';
import { BottomBar, MobileMenu } from './MobileNav';
import { Sidebar } from './Sidebar';

const SIDEBAR_KEY = 'sbc-admin-sidebar-open';

function readSidebarOpen(): boolean {
  try { return localStorage.getItem(SIDEBAR_KEY) !== '0'; } catch { return true; }
}

/**
 * The signed-in admin's frame:
 * - computer (md+): collapsible sidebar, top bar, content;
 * - phone: top bar with the menu button, content, bottom bar of shortcuts.
 *
 * The page itself never scrolls; the content area does. Original pages that
 * are wider than the screen (big tables) scroll sideways inside that area,
 * never the whole screen.
 */
export function AppShell() {
  const { pathname } = useLocation();
  const reduceMotion = useReducedMotion();
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarOpen);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLElement>(null);

  const toggleSidebar = () => {
    setSidebarOpen(open => {
      try { localStorage.setItem(SIDEBAR_KEY, open ? '0' : '1'); } catch { /* not remembered */ }
      return !open;
    });
  };

  // A new page starts at the top, and the phone menu closes behind it.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, left: 0 });
    setMobileMenuOpen(false);
  }, [pathname]);

  // The phone menu has no place on a computer screen.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 48rem)');
    const onChange = () => { if (mq.matches) setMobileMenuOpen(false); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-fg">
      <Sidebar open={sidebarOpen} onToggle={toggleSidebar} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header onOpenMobileMenu={() => setMobileMenuOpen(true)} />

        <main ref={scrollRef} id="main" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          {/* Opacity only: a transform here would trap the original pages' `fixed` modals. */}
          <motion.div
            key={pathname}
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="shell-content w-full min-w-0 overflow-x-clip px-3 py-4 md:px-6 md:py-6"
          >
            <Outlet />
          </motion.div>
        </main>

        <BottomBar onOpenMenu={() => setMobileMenuOpen(true)} menuOpen={mobileMenuOpen} />
      </div>

      <MobileMenu open={mobileMenuOpen} onOpenChange={setMobileMenuOpen} />
      <CommandPalette />
    </div>
  );
}
