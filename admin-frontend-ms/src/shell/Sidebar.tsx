import { Link } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { Logout01Icon, PanelLeftCloseIcon, PanelLeftOpenIcon } from '@hugeicons/core-free-icons';
import { LOGOUT, type MenuGroup, type MenuItem } from '../navigation/menu';
import { Tooltip } from '../components/ui';
import { cn } from '../lib/cn';
import { BRAND_NAME, BrandLogo } from './BrandMark';
import { useMenu } from './useMenu';

/** One menu entry; also used by the phone menu. */
export function NavEntry({ item, active, collapsed, onNavigate, large }: {
  item: MenuItem;
  active: boolean;
  collapsed?: boolean;
  onNavigate?: () => void;
  /** Phone menu: 44px touch targets. */
  large?: boolean;
}) {
  const link = (
    <Link
      to={item.path}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        'group flex w-full items-center gap-3 rounded-control text-left text-sm transition-colors',
        large ? 'h-11 px-3' : collapsed ? 'h-9 justify-center' : 'h-9 px-3',
        active ? 'bg-primary-soft font-medium text-primary' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
      )}
    >
      <HugeiconsIcon
        icon={item.icon}
        size={18}
        aria-hidden="true"
        className={cn('shrink-0', active ? 'text-primary' : 'text-fg-subtle group-hover:text-fg-muted')}
      />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
  return collapsed ? <Tooltip content={item.label} side="right">{link}</Tooltip> : link;
}

/** The groups of the menu, as a list of headed sections. */
export function MenuSections({ groups, activePath, collapsed, onNavigate, large }: {
  groups: MenuGroup[];
  activePath?: string;
  collapsed?: boolean;
  onNavigate?: () => void;
  large?: boolean;
}) {
  return (
    <>
      {groups.map((group, gi) => (
        <div key={group.id} className={cn(gi > 0 && (collapsed ? 'mt-3 border-t border-line pt-3' : 'mt-5'))}>
          {!collapsed && <p className="mb-1 px-3 text-xs font-medium text-fg-subtle">{group.label}</p>}
          <ul className="space-y-0.5">
            {group.items.map(item => (
              <li key={item.path}>
                <NavEntry item={item} active={item.path === activePath} collapsed={collapsed} onNavigate={onNavigate} large={large} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

/**
 * Computer navigation (md and up): a column of grouped pages, collapsible to
 * icons (248px / 64px; the choice is remembered by AppShell).
 */
export function Sidebar({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  // A limited account's home is its first readable page, not a dashboard it cannot open.
  const { groups, activePath, home } = useMenu();
  const toggleLabel = open ? 'Réduire le menu' : 'Agrandir le menu';

  const logout = (
    <Link
      to={LOGOUT.path}
      aria-label={open ? undefined : LOGOUT.label}
      className={cn('flex h-9 w-full items-center gap-3 rounded-control text-sm text-fg-muted hover:bg-danger-soft hover:text-danger', open ? 'px-3' : 'justify-center')}
    >
      <HugeiconsIcon icon={Logout01Icon} size={18} aria-hidden="true" className="shrink-0" />
      {open && <span>{LOGOUT.label}</span>}
    </Link>
  );

  return (
    <aside
      className={cn(
        'hidden h-dvh shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200 motion-reduce:transition-none md:flex',
        open ? 'w-[248px]' : 'w-16',
      )}
    >
      <Link to={home} className={cn('flex h-14 shrink-0 items-center gap-2.5 border-b border-line', open ? 'px-4' : 'justify-center')} aria-label={`${BRAND_NAME}, accueil`}>
        <BrandLogo size={30} />
        {open && <span className="truncate text-sm font-semibold text-fg">{BRAND_NAME}</span>}
      </Link>

      <nav aria-label="Navigation principale" className={cn('flex-1 overflow-y-auto py-3', open ? 'px-3' : 'px-2')}>
        <MenuSections groups={groups} activePath={activePath} collapsed={!open} />
      </nav>

      <div className={cn('shrink-0 space-y-0.5 border-t border-line py-2', open ? 'px-3' : 'px-2')}>
        {open ? logout : <Tooltip content={LOGOUT.label} side="right">{logout}</Tooltip>}
        <Tooltip content={toggleLabel} side="right">
          <button
            type="button"
            onClick={onToggle}
            aria-label={toggleLabel}
            aria-expanded={open}
            className={cn('flex h-9 w-full items-center gap-3 rounded-control text-fg-subtle hover:bg-surface-2 hover:text-fg', open ? 'px-3' : 'justify-center')}
          >
            <HugeiconsIcon icon={open ? PanelLeftCloseIcon : PanelLeftOpenIcon} size={18} aria-hidden="true" />
            {open && <span className="text-sm">{toggleLabel}</span>}
          </button>
        </Tooltip>
      </div>
    </aside>
  );
}
