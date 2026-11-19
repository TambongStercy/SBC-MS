import { useNavigate } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { ComputerIcon, Logout01Icon, Menu01Icon, Moon02Icon, Search01Icon, Sun03Icon } from '@hugeicons/core-free-icons';
import { useAgent } from '../auth/context';
import { useTheme, type ThemePreference } from '../contexts/theme';
import { roleLabel } from '../lib/permissions';
import { LOGOUT } from '../navigation/menu';
import {
  Avatar, Button, Kbd, Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger, Tooltip,
} from '../components/ui';
import { BRAND_NAME, BrandLogo } from './BrandMark';
import { openCommandPalette } from './events';

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun03Icon }[] = [
  { value: 'light', label: 'Clair', icon: Sun03Icon },
  { value: 'dark', label: 'Sombre', icon: Moon02Icon },
  { value: 'system', label: 'Comme l’appareil', icon: ComputerIcon },
];

function ThemeMenu() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <Menu>
      <Tooltip content="Apparence">
        <MenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Apparence">
            <HugeiconsIcon icon={resolved === 'dark' ? Moon02Icon : Sun03Icon} size={19} aria-hidden="true" />
          </Button>
        </MenuTrigger>
      </Tooltip>
      <MenuContent className="w-52">
        <MenuLabel>Apparence</MenuLabel>
        <MenuRadioGroup value={preference} onValueChange={v => setPreference(v as ThemePreference)}>
          {THEME_OPTIONS.map(o => (
            <MenuRadioItem key={o.value} value={o.value}>
              <HugeiconsIcon icon={o.icon} size={16} aria-hidden="true" /> {o.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

/** Top bar: phone menu button, search / go to (Ctrl+K), theme, account menu. */
export function Header({ onOpenMobileMenu }: { onOpenMobileMenu: () => void }) {
  const navigate = useNavigate();
  const agent = useAgent();
  const roles = agent.roles.map(roleLabel).join(', ');
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <header className="flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center gap-2 border-b border-line bg-surface px-3 pt-[env(safe-area-inset-top)] md:gap-3 md:px-6">
      <button type="button" onClick={onOpenMobileMenu} aria-label="Ouvrir le menu"
        className="-ml-1 flex h-11 w-11 items-center justify-center rounded-control text-fg-muted hover:bg-surface-2 md:hidden">
        <HugeiconsIcon icon={Menu01Icon} size={20} aria-hidden="true" />
      </button>
      <div className="flex min-w-0 items-center gap-2 md:hidden">
        <BrandLogo size={26} />
        <span className="truncate text-sm font-semibold text-fg">{BRAND_NAME}</span>
      </div>

      <button type="button" onClick={openCommandPalette} aria-label="Rechercher ou aller à…"
        className="ml-auto flex h-11 w-11 items-center justify-center gap-2 rounded-control text-fg-muted transition-colors hover:bg-surface-2 md:ml-0 md:h-9 md:w-80 md:justify-start md:border md:border-line md:bg-surface-2 md:px-3 md:text-sm md:text-fg-subtle md:hover:border-line-strong">
        <HugeiconsIcon icon={Search01Icon} size={18} aria-hidden="true" />
        <span className="hidden flex-1 text-left md:inline">Rechercher ou aller à…</span>
        <span className="hidden items-center gap-1 md:flex"><Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd><Kbd>K</Kbd></span>
      </button>

      <div className="flex items-center gap-1 md:ml-auto">
        <ThemeMenu />
        <Menu>
          <MenuTrigger asChild>
            <button type="button" className="flex items-center gap-2.5 rounded-control p-1 hover:bg-surface-2 md:pr-2.5" aria-label="Mon compte">
              <Avatar name={agent.name} size="sm" />
              <span className="hidden min-w-0 text-left md:block">
                <span className="block max-w-[180px] truncate text-sm font-medium leading-tight text-fg">{agent.name}</span>
                <span className="block max-w-[180px] truncate text-xs leading-tight text-fg-muted">{roles}</span>
              </span>
            </button>
          </MenuTrigger>
          <MenuContent className="w-64">
            <div className="px-2.5 py-2">
              <p className="truncate text-sm font-medium text-fg">{agent.name}</p>
              <p className="truncate text-xs text-fg-muted">{agent.email}</p>
              <p className="mt-1 text-xs text-fg-subtle">{roles}</p>
            </div>
            <MenuSeparator />
            <MenuItem destructive onSelect={() => navigate(LOGOUT.path)}>
              <HugeiconsIcon icon={Logout01Icon} size={16} aria-hidden="true" /> {LOGOUT.label}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </header>
  );
}
