import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { LogOut, Moon, Sun, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeProvider';
import { ROLE_LABEL } from '../lib/roles';
import { useQueueCounts } from '../features/home/queues';
import { Avatar, CountBadge, IconButton, cn } from '../ui';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { MenuContext } from '../ui/menuContext';
import { isCurrent, menuFor } from './menu';

/** The menu itself, shared by the computer sidebar and the phone drawer. */
function MenuBody({ onNavigate }: { onNavigate?: () => void }) {
    const { role, adminUser } = useAuth();
    const { theme, setTheme } = useTheme();
    const { pathname, search } = useLocation();
    const { defs, results } = useQueueCounts(role);
    const count = (keys?: string[]) => (keys ?? []).reduce((s, k) => s + (results[defs.findIndex(d => d.key === k)]?.data?.count ?? 0), 0);

    return (
        <div className="flex flex-col h-full">
            <nav className="flex-1 overflow-y-auto px-3 pb-3" aria-label="Menu">
                {menuFor(role).map((section, i) => (
                    <div key={section.title ?? i} className={cn(i > 0 && 'mt-4')}>
                        {section.title && <p className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-ink-3">{section.title}</p>}
                        <div className="space-y-0.5">
                            {section.items.map(item => {
                                const active = isCurrent(item, pathname, search);
                                return (
                                    <NavLink key={item.to} to={item.to} onClick={onNavigate} aria-current={active ? 'page' : undefined}
                                        className={cn('flex items-center gap-3 rounded-tile px-3 h-10 text-[15px] font-semibold transition-colors',
                                            active ? 'bg-primary-soft text-primary' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}>
                                        <item.icon size={18} className="shrink-0" />
                                        <span className="flex-1 truncate">{item.label}</span>
                                        <CountBadge count={count(item.badge)} />
                                    </NavLink>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </nav>
            <div className="border-t border-border p-3 space-y-1">
                <div className="flex items-center gap-2.5 px-2 py-1.5">
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
                <Link to="/logout" onClick={onNavigate} className="flex items-center gap-3 rounded-tile px-3 h-10 text-sm font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink">
                    <LogOut size={18} />Déconnexion
                </Link>
            </div>
        </div>
    );
}

function Brand() {
    return (
        <span className="flex items-center gap-2.5">
            <img src="/sbc-app-icon.png" alt="" className="size-8 rounded-tile" />
            <span className="font-extrabold tracking-tight">SBC Admin</span>
        </span>
    );
}

/**
 * The admin's frame. On a computer every page is listed in the sidebar; on a
 * phone the same list opens from the ☰ button at the top of each page.
 */
export default function AppShell() {
    const { pathname } = useLocation();
    const [drawer, setDrawer] = useState(false);
    const openMenu = useCallback(() => setDrawer(true), []);
    const close = useCallback(() => setDrawer(false), []);

    useEffect(() => { setDrawer(false); }, [pathname]);
    useEffect(() => {
        if (!drawer) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(false); };
        window.addEventListener('keydown', onKey);
        return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
    }, [drawer]);

    return (
        <MenuContext.Provider value={openMenu}>
            <div className="min-h-screen bg-bg text-ink lg:flex">
                <aside className="hidden lg:flex lg:flex-col w-72 shrink-0 h-screen sticky top-0 border-r border-border bg-surface">
                    <Link to="/" className="flex items-center px-5 h-16 shrink-0"><Brand /></Link>
                    <div className="flex-1 min-h-0"><MenuBody /></div>
                </aside>

                <main className="flex-1 min-w-0 pb-[env(safe-area-inset-bottom,0px)]">
                    <ErrorBoundary resetKey={pathname}><Outlet /></ErrorBoundary>
                </main>

                {drawer && (
                    <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Menu">
                        <div className="absolute inset-0 bg-black/50 animate-[fade-in_150ms_ease-out]" onClick={close} />
                        <div className="absolute inset-y-0 left-0 w-[min(20rem,86vw)] bg-surface border-r border-border flex flex-col pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] animate-[drawer-in_180ms_ease-out]">
                            <div className="flex items-center justify-between px-5 h-14 shrink-0">
                                <Link to="/" onClick={close}><Brand /></Link>
                                <IconButton label="Fermer le menu" onClick={close} className="-mr-2"><X size={20} /></IconButton>
                            </div>
                            <div className="flex-1 min-h-0"><MenuBody onNavigate={close} /></div>
                        </div>
                    </div>
                )}
            </div>
        </MenuContext.Provider>
    );
}
