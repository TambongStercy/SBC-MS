import { useNavigate } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { ComputerIcon, Download01Icon, Logout01Icon, SecurityLockIcon, Menu01Icon, Moon02Icon, Search01Icon, Sun03Icon, ViewIcon } from '@hugeicons/core-free-icons';
import { useCurrentAccess } from '../hooks/usePermission';
import { useAuth } from '../context/AuthContext';
import { useTheme, type ThemePreference } from '../contexts/theme';
import { ROLE_LABEL } from '../lib/roles';
import { LOGOUT } from '../navigation/menu';
import { useInstallApp } from '../pwa/InstallApp';
import {
  Avatar, Badge, Button, Kbd, Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger, Tooltip,
} from '../components/ui';
import { BrandLogo } from './BrandMark';
import { openCommandPalette } from './events';

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun03Icon }[] = [
  { value: 'light', label: 'Clair', icon: Sun03Icon },
  { value: 'dark', label: 'Sombre', icon: Moon02Icon },
  { value: 'system', label: 'Comme l’appareil', icon: ComputerIcon },
];

/** Theme menu: light, dark or the device's setting. */
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

/** "Lecture seule" when the current screen's module is readable but not changeable. */
function ReadOnlyBadge() {
  const { access } = useCurrentAccess();
  if (access !== 'read') return null;
  return (
    <Tooltip content="Vous pouvez consulter cet espace, sans rien y changer.">
      {/* A plain span takes the tooltip's ref (Badge does not forward one). */}
      <span tabIndex={0} className="inline-flex shrink-0 cursor-default rounded-md focus-visible:outline-2 focus-visible:outline-primary" aria-label="Lecture seule : vous pouvez consulter cet espace, sans rien y changer.">
        <Badge tone="warning" className="py-1" aria-hidden="true">
          <HugeiconsIcon icon={ViewIcon} size={14} aria-hidden="true" />
          Lecture seule
        </Badge>
      </span>
    </Tooltip>
  );
}

/**
 * Top bar: phone menu button and logo (phones), search / go to (Ctrl+K),
 * the "Lecture seule" badge on a read-only screen, theme, and the account
 * menu (name, role, install, log out).
 */
export function Header({ onOpenMobileMenu }: { onOpenMobileMenu: () => void }) {
  const navigate = useNavigate();
  const { adminUser, role } = useAuth();
  const install = useInstallApp();
  const name = adminUser?.name || adminUser?.email?.split('@')[0] || 'Admin';
  const roleLabel = role ? ROLE_LABEL[role] ?? role : '';
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <header className="flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center gap-2 border-b border-line bg-surface px-3 pt-[env(safe-area-inset-top)] md:gap-3 md:px-6">
      <button
        type="button"
        onClick={onOpenMobileMenu}
        aria-label="Ouvrir le menu"
        className="-ml-1 flex h-11 w-11 items-center justify-center rounded-control text-fg-muted hover:bg-surface-2 md:hidden"
      >
        <HugeiconsIcon icon={Menu01Icon} size={20} aria-hidden="true" />
      </button>
      <div className="flex min-w-0 items-center gap-2 md:hidden">
        <BrandLogo size={26} />
        <span className="truncate text-sm font-semibold text-fg">SBC Admin</span>
      </div>

      {/* Search: go to any page, run an action (Ctrl+K) */}
      <button
        type="button"
        onClick={openCommandPalette}
        aria-label="Rechercher ou aller à…"
        className="ml-auto flex h-11 w-11 items-center justify-center gap-2 rounded-control text-fg-muted transition-colors hover:bg-surface-2 md:ml-0 md:h-9 md:w-80 md:justify-start md:border md:border-line md:bg-surface-2 md:px-3 md:text-sm md:text-fg-subtle md:hover:border-line-strong"
      >
        <HugeiconsIcon icon={Search01Icon} size={18} aria-hidden="true" />
        <span className="hidden flex-1 text-left md:inline">Rechercher ou aller à…</span>
        <span className="hidden items-center gap-1 md:flex"><Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd><Kbd>K</Kbd></span>
      </button>

      <ReadOnlyBadge />

      <div className="flex items-center gap-1 md:ml-auto">
        <ThemeMenu />

        <Menu>
          <MenuTrigger asChild>
            <button type="button" className="flex items-center gap-2.5 rounded-control p-1 hover:bg-surface-2 md:pr-2.5" aria-label="Mon compte">
              <Avatar src={adminUser?.avatar} name={name} size="sm" />
              <span className="hidden min-w-0 text-left md:block">
                <span className="block max-w-[160px] truncate text-sm font-medium leading-tight text-fg">{name}</span>
                {roleLabel && <span className="block max-w-[160px] truncate text-xs leading-tight text-fg-muted">{roleLabel}</span>}
              </span>
            </button>
          </MenuTrigger>
          <MenuContent className="w-64">
            <div className="px-2.5 py-2">
              <p className="truncate text-sm font-medium text-fg">{name}</p>
              {adminUser?.email && <p className="truncate text-xs text-fg-muted">{adminUser.email}</p>}
              {roleLabel && <p className="mt-1 text-xs text-fg-subtle">{roleLabel}</p>}
            </div>
            <MenuSeparator />
            {install.available && (
              <MenuItem onSelect={install.start}>
                <HugeiconsIcon icon={Download01Icon} size={16} aria-hidden="true" /> Installer l'application
              </MenuItem>
            )}
            <MenuItem onSelect={() => navigate('/securite')}>
              <HugeiconsIcon icon={SecurityLockIcon} size={16} aria-hidden="true" /> Sécurité du compte
            </MenuItem>
            <MenuItem destructive onSelect={() => navigate(LOGOUT.path)}>
              <HugeiconsIcon icon={Logout01Icon} size={16} aria-hidden="true" /> {LOGOUT.label}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      {install.helpDialog}
    </header>
  );
}
