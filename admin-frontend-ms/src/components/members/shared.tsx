import { useEffect, useState, type ReactNode } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Search01Icon } from '@hugeicons/core-free-icons';
import { getAvatarUrl } from '../../api/apiClient';
import { SubscriptionType, type AdminUserData } from '../../services/adminUserApi';
import { ROLE_LABEL } from '../../lib/roles';
import { Avatar, Badge, Input } from '../ui';
import { cn } from '../../lib/cn';

/** Photo (or initials), name and a second line (email by default). */
export function MemberIdentity({ name, email, avatar, sub, className }: {
  name?: string;
  email?: string;
  avatar?: string;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 items-center gap-3', className)}>
      <Avatar src={avatar ? getAvatarUrl(avatar) : null} name={name || email || '?'} size="sm" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-fg">{name || 'Sans nom'}</p>
        <p className="truncate text-xs text-fg-muted">{sub ?? email ?? '—'}</p>
      </div>
    </div>
  );
}

/** Account state: Supprimé / Bloqué / Actif. */
export function AccountStatusBadge({ user }: { user: Pick<AdminUserData, 'blocked' | 'deleted'> }) {
  if (user.deleted) return <Badge tone="neutral">Supprimé</Badge>;
  if (user.blocked) return <Badge tone="danger">Bloqué</Badge>;
  return <Badge tone="success">Actif</Badge>;
}

/** Active packs: Ciblé / Classique / none, plus Relance when on. */
export function SubscriptionBadges({ types }: { types?: SubscriptionType[] | string[] }) {
  const list = (types ?? []) as string[];
  const main = list.includes(SubscriptionType.CIBLE) ? 'Ciblé' : list.includes(SubscriptionType.CLASSIQUE) ? 'Classique' : null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {main ? <Badge tone={main === 'Ciblé' ? 'primary' : 'info'}>{main}</Badge> : <Badge tone="outline">Sans abonnement</Badge>}
      {list.includes(SubscriptionType.RELANCE) && <Badge tone="neutral">Relance</Badge>}
    </span>
  );
}

const ROLE_TONE: Record<string, 'primary' | 'info' | 'warning' | 'neutral' | 'danger'> = {
  admin: 'danger',
  staff: 'info',
  withdrawal_admin: 'warning',
  moderator: 'warning',
  tester: 'primary',
};

export function RoleBadge({ role }: { role?: string }) {
  const r = role || 'user';
  return <Badge tone={ROLE_TONE[r] ?? 'neutral'}>{ROLE_LABEL[r] ?? r}</Badge>;
}

/** Search box that writes to the URL after a short pause. */
export function SearchInput({ value, onChange, placeholder, className }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => onChange(text.trim()), 400);
    return () => clearTimeout(t);
  }, [text, value, onChange]);
  return (
    <div className={cn('relative min-w-0 sm:w-80', className)}>
      <HugeiconsIcon icon={Search01Icon} size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
      <Input
        type="search"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onChange(text.trim()); }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-11 pl-9 sm:h-9"
      />
    </div>
  );
}
