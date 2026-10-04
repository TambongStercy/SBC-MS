import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { LogOut, Moon, Sun } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeProvider';
import { ROLE_LABEL } from '../lib/roles';
import { useQueueCounts } from '../features/home/queues';
import { Avatar, CountBadge, cn } from '../ui';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { isActive, navFor } from './nav';

/**
 * The admin's frame: a bottom bar on a phone (where 94% of admin use happens),
 * a left rail on a computer. The À traiter tab carries the total waiting.
 */
export default function AppShell() {
    const { role, adminUser } = useAuth();
    const { theme, setTheme } = useTheme();
    const { pathname } = useLocation();
    const items = navFor(role);
    const { total } = useQueueCounts(role);

    return (
        <div className="min-h-screen bg-bg text-ink lg:flex">
            {/* Computer: left rail */}
            <aside className="hidden lg:flex lg:flex-col w-60 shrink-0 h-screen sticky top-0 border-r border-border bg-surface">
                <Link to="/" className="flex items-center gap-2.5 px-5 h-16">
                    <img src="/sbc-app-icon.png" alt="" className="size-8 rounded-tile" />
                    <span className="font-extrabold tracking-tight">SBC Admin</span>
                </Link>
                <nav className="flex-1 px-3 py-2 space-y-1" aria-label="Navigation principale">
                    {items.map(item => {
                        const active = isActive(item, pathname);
                        return (
                            <NavLink key={item.to} to={item.to}
                                className={cn('flex items-center gap-3 rounded-tile px-3 h-11 text-[15px] font-semibold transition-colors',
                                    active ? 'bg-primary-soft text-primary' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}>
                                <item.icon size={20} />
                                <span className="flex-1">{item.label}</span>
                                {item.to === '/' && <CountBadge count={total} />}
                            </NavLink>
                        );
                    })}
                </nav>
                <div className="border-t border-border p-3 space-y-1">
                    <div className="flex items-center gap-2.5 px-2 py-2">
                        <Avatar name={adminUser?.name} size={32} />
                        <div className="min-w-0">
                            <div className="text-sm font-semibold truncate">{adminUser?.name || 'Admin'}</div>
                            <div className="text-xs text-ink-3">{ROLE_LABEL[role ?? ''] ?? role}</div>
                        </div>
                    </div>
                    <button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                        className="w-full flex items-center gap-3 rounded-tile px-3 h-10 text-sm font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink">
                        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                        {theme === 'dark' ? 'Thème clair' : 'Thème sombre'}
                    </button>
                    <Link to="/logout" className="flex items-center gap-3 rounded-tile px-3 h-10 text-sm font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink">
                        <LogOut size={18} />Déconnexion
                    </Link>
                </div>
            </aside>

            {/* Content: room at the bottom on a phone for the tab bar */}
            <main className="flex-1 min-w-0 pb-[calc(env(safe-area-inset-bottom,0px)+72px)] lg:pb-0">
                <ErrorBoundary resetKey={pathname}><Outlet /></ErrorBoundary>
            </main>

            {/* Phone: bottom tab bar */}
            <nav aria-label="Navigation principale"
                className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-surface/95 backdrop-blur border-t border-border pb-[env(safe-area-inset-bottom,0px)]">
                <div className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
                    {items.map(item => {
                        const active = isActive(item, pathname);
                        return (
                            <NavLink key={item.to} to={item.to}
                                className={cn('relative flex flex-col items-center justify-center gap-0.5 h-16 text-[11px] font-semibold',
                                    active ? 'text-primary' : 'text-ink-3')}>
                                <span className="relative">
                                    <item.icon size={22} strokeWidth={active ? 2.4 : 2} />
                                    {item.to === '/' && <CountBadge count={total} className="absolute -top-2 -right-3" />}
                                </span>
                                {item.label}
                            </NavLink>
                        );
                    })}
                </div>
            </nav>
        </div>
    );
}
