import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import { Dialog as D } from 'radix-ui';
import { HugeiconsIcon } from '@hugeicons/react';
import { ComputerIcon, Logout01Icon, Moon02Icon, Search01Icon, Sun03Icon } from '@hugeicons/core-free-icons';
import { useTheme } from '../contexts/theme';
import { LOGOUT } from '../navigation/menu';
import { Kbd } from '../components/ui';
import { OPEN_COMMAND_EVENT } from './events';
import { useMenu } from './useMenu';

const item = 'flex min-h-10 cursor-default select-none items-center gap-3 rounded-md px-3 py-2 text-sm text-fg data-[selected=true]:bg-surface-2 [&_svg]:shrink-0 [&_svg]:text-fg-subtle';
const group = '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-subtle';

/** Ctrl+K / Cmd+K: go to any screen the agent can open, switch theme, log out. */
export function CommandPalette() {
  const navigate = useNavigate();
  const { setPreference } = useTheme();
  const { groups } = useMenu();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o); }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_COMMAND_EVENT, onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener(OPEN_COMMAND_EVENT, onOpen); };
  }, []);

  const run = (fn: () => void) => { setOpen(false); fn(); };

  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-[240] bg-black/50" />
        <D.Content className="fixed left-1/2 top-[max(1rem,10vh)] z-[241] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-panel border border-line bg-surface focus:outline-none">
          <D.Title className="sr-only">Rechercher ou aller à…</D.Title>
          <D.Description className="sr-only">Tapez le nom d’un écran ou d’une action.</D.Description>
          <Command label="Rechercher ou aller à…" loop>
            <div className="flex items-center gap-3 border-b border-line px-4">
              <HugeiconsIcon icon={Search01Icon} size={18} className="shrink-0 text-fg-subtle" aria-hidden="true" />
              <Command.Input placeholder="Un écran ou une action…" className="h-12 w-full bg-transparent text-base text-fg placeholder:text-fg-subtle focus:outline-none md:text-sm" />
              <Kbd className="hidden sm:inline-flex">Esc</Kbd>
            </div>
            <Command.List className="max-h-[min(60dvh,440px)] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-sm text-fg-muted">Aucun résultat.</Command.Empty>
              {groups.map(g => (
                <Command.Group key={g.id} heading={g.label} className={group}>
                  {g.items.map(entry => (
                    <Command.Item key={entry.path} value={`${entry.label} ${g.label} ${entry.path}`} onSelect={() => run(() => navigate(entry.path))} className={item}>
                      <HugeiconsIcon icon={entry.icon} size={16} aria-hidden="true" />
                      {entry.label}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
              <Command.Group heading="Actions" className={group}>
                <Command.Item value="thème clair light" onSelect={() => run(() => setPreference('light'))} className={item}>
                  <HugeiconsIcon icon={Sun03Icon} size={16} aria-hidden="true" /> Thème clair
                </Command.Item>
                <Command.Item value="thème sombre dark" onSelect={() => run(() => setPreference('dark'))} className={item}>
                  <HugeiconsIcon icon={Moon02Icon} size={16} aria-hidden="true" /> Thème sombre
                </Command.Item>
                <Command.Item value="thème de l'appareil système system" onSelect={() => run(() => setPreference('system'))} className={item}>
                  <HugeiconsIcon icon={ComputerIcon} size={16} aria-hidden="true" /> Thème de l’appareil
                </Command.Item>
                <Command.Item value="déconnexion se déconnecter logout" onSelect={() => run(() => navigate(LOGOUT.path))} className={item}>
                  <HugeiconsIcon icon={Logout01Icon} size={16} aria-hidden="true" /> Se déconnecter
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
