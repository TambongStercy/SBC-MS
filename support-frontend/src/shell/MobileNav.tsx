import { Link } from 'react-router-dom';
import { Dialog as D } from 'radix-ui';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, Logout01Icon, Menu01Icon, Moon02Icon, Sun03Icon } from '@hugeicons/core-free-icons';
import { useAgent } from '../auth/context';
import { useTheme } from '../contexts/theme';
import { roleLabel } from '../lib/permissions';
import { LOGOUT } from '../navigation/menu';
import { Avatar } from '../components/ui';
import { cn } from '../lib/cn';
import { BRAND_NAME, BrandLogo } from './BrandMark';
import { MenuSections } from './Sidebar';
import { useMenu } from './useMenu';

/** Phones: the whole menu, full screen. */
export function MobileMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { groups, activePath } = useMenu();
  const agent = useAgent();
  const { resolved, setPreference } = useTheme();
  const close = () => onOpenChange(false);
  const footerButton = 'flex h-11 w-full items-center gap-3 rounded-control px-3 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg';

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Content className="fixed inset-0 z-[90] flex flex-col bg-surface pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] focus:outline-none md:hidden" aria-describedby={undefined}>
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <BrandLogo size={28} />
              <D.Title className="truncate text-sm font-semibold text-fg">{BRAND_NAME}</D.Title>
            </div>
            <D.Close className="-mr-2 flex h-11 w-11 items-center justify-center rounded-control text-fg-muted hover:bg-surface-2" aria-label="Fermer le menu">
              <HugeiconsIcon icon={Cancel01Icon} size={20} aria-hidden="true" />
            </D.Close>
          </div>
          <nav aria-label="Navigation principale" className="flex-1 overflow-y-auto px-3 py-3">
            <MenuSections groups={groups} activePath={activePath} onNavigate={close} large />
          </nav>
          <div className="shrink-0 space-y-0.5 border-t border-line px-3 py-2">
            <div className="flex items-center gap-3 px-3 py-2">
              <Avatar name={agent.name} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-fg">{agent.name}</p>
                <p className="truncate text-xs text-fg-muted">{agent.roles.map(roleLabel).join(', ')}</p>
              </div>
            </div>
            <button type="button" className={footerButton} onClick={() => setPreference(resolved === 'dark' ? 'light' : 'dark')}>
              <HugeiconsIcon icon={resolved === 'dark' ? Sun03Icon : Moon02Icon} size={18} aria-hidden="true" className="text-fg-subtle" />
              {resolved === 'dark' ? 'Thème clair' : 'Thème sombre'}
            </button>
            <Link to={LOGOUT.path} onClick={close} className={cn(footerButton, 'hover:bg-danger-soft hover:text-danger')}>
              <HugeiconsIcon icon={Logout01Icon} size={18} aria-hidden="true" className="text-fg-subtle" />
              {LOGOUT.label}
            </Link>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Phones: up to three shortcuts for the agent, then "Menu". */
export function BottomBar({ onOpenMenu, menuOpen }: { onOpenMenu: () => void; menuOpen: boolean }) {
  const { shortcuts, activePath } = useMenu();
  const tab = 'flex min-w-0 flex-1 flex-col items-center justify-center gap-1 py-2 min-h-14';
  return (
    <nav aria-label="Raccourcis" className="flex shrink-0 items-stretch border-t border-line bg-surface px-1 pb-[env(safe-area-inset-bottom)] md:hidden">
      {shortcuts.map(item => {
        const active = item.path === activePath;
        return (
          <Link key={item.path} to={item.path} aria-current={active ? 'page' : undefined} className={cn(tab, active ? 'text-primary' : 'text-fg-subtle hover:text-fg')}>
            <HugeiconsIcon icon={item.icon} size={22} aria-hidden="true" />
            <span className="max-w-full truncate px-1 text-[11px] font-medium leading-tight">{item.label}</span>
          </Link>
        );
      })}
      <button type="button" onClick={onOpenMenu} aria-expanded={menuOpen} className={cn(tab, menuOpen ? 'text-primary' : 'text-fg-subtle hover:text-fg')}>
        <HugeiconsIcon icon={Menu01Icon} size={22} aria-hidden="true" />
        <span className="text-[11px] font-medium leading-tight">Menu</span>
      </button>
    </nav>
  );
}
