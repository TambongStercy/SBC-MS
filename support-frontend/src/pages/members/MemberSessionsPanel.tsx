import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { PlayCircleIcon, Cursor01Icon } from '@hugeicons/core-free-icons';
import { errorMessage } from '../../api/http';
import { membersApi, type ReplaySession } from '../../api/members';
import { usePermissions } from '../../auth/context';
import { toast } from '../../components/toast';
import { Badge, Button, Panel, PanelBody, PanelHeader, Skeleton } from '../../components/ui';
import { formatDateTime } from '../../lib/format';

/**
 * Session replay + live assistance (OpenReplay, 2026-11-23) on the member page and on a ticket.
 * - « Sessions » (`replay.read`): the member's sessions open now and recordings of the last
 *   30 days; each opening goes through an audited call that gives the link.
 * - « Assistance en direct » (`assist.control`, support agents and administrators): opens a 30-minute grant
 *   for this agent, then the live view in OpenReplay, where « Remote control » asks the member.
 *   The member must accept; the withdrawal, code, password, contact-change, authenticator,
 *   identity and data pages refuse control whatever happens. The agent's OpenReplay account
 *   must use the same e-mail as their desk account.
 */
const minutes = (ms: number | null) => (ms == null ? '' : ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`);

/** Opens a tab on the click (browsers block one opened after an await), then sends it to the link. */
async function openInTab(get: () => Promise<{ url: string }>, fail: string) {
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  try {
    const { url } = await get();
    if (tab) tab.location.href = url; else window.location.assign(url);
  } catch (e) {
    tab?.close();
    toast.error(errorMessage(e, fail));
  }
}

export function AssistButton({ memberId, ticketId, className }: { memberId: string; ticketId?: string; className?: string }) {
  const perms = usePermissions();
  const [busy, setBusy] = useState(false);
  const [grant, setGrant] = useState<{ id: string; until: string } | null>(null);
  if (!perms.has('assist.control')) return null;

  const start = async () => {
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    setBusy(true);
    try {
      const r = await membersApi.startAssist(memberId, ticketId);
      setGrant({ id: r.grantId, until: r.expiresAt });
      const live = r.live[0];
      if (!live) {
        tab?.close();
        toast.info('Assistance ouverte, mais le membre n’a pas l’app ouverte. Demandez-lui de l’ouvrir, puis rouvrez « Sessions ».');
        return;
      }
      if (tab) tab.location.href = live.url; else window.location.assign(live.url);
      toast.success('Dans OpenReplay, cliquez « Remote control » : le membre doit accepter sur son téléphone.');
    } catch (e) {
      tab?.close();
      toast.error(errorMessage(e, 'Impossible d’ouvrir l’assistance.'));
    } finally {
      setBusy(false);
    }
  };
  const end = async () => {
    if (!grant) return;
    setBusy(true);
    try { await membersApi.endAssist(grant.id); setGrant(null); toast.success('Assistance terminée.'); }
    catch (e) { toast.error(errorMessage(e, 'Impossible de terminer l’assistance.')); }
    finally { setBusy(false); }
  };

  return (
    <div className={className}>
      {grant ? (
        <Button variant="outline" className="w-full" loading={busy} onClick={end}>Terminer l’assistance en direct</Button>
      ) : (
        <Button variant="outline" className="w-full" loading={busy} onClick={start}>
          <HugeiconsIcon icon={Cursor01Icon} size={16} aria-hidden="true" />
          Assistance en direct
        </Button>
      )}
      <p className="mt-2 text-xs text-fg-muted">
        {grant
          ? `Ouverte jusqu’à ${formatDateTime(grant.until)}. Le membre peut arrêter à tout moment.`
          : 'Voir l’écran du membre en direct et lui demander le contrôle à distance. Le membre doit accepter ; impossible sur les pages de retrait, de codes ou de coordonnées. Tout est noté dans le journal.'}
      </p>
    </div>
  );
}

function SessionRow({ memberId, s }: { memberId: string; s: ReplaySession }) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    await openInTab(() => membersApi.openSession(memberId, s.sessionId, s.live), 'Impossible d’ouvrir la session.');
    setBusy(false);
  };
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0 text-sm">
        <div className="flex items-center gap-2">
          {s.live ? <Badge tone="success">En direct</Badge> : <span className="text-fg">{s.startedAt ? formatDateTime(s.startedAt) : '—'}</span>}
          {!s.live && s.durationMs != null && <span className="text-fg-muted">{minutes(s.durationMs)}</span>}
          {s.pages != null && <span className="text-fg-muted">· {s.pages} page{s.pages > 1 ? 's' : ''}</span>}
        </div>
        {s.device && <div className="truncate text-xs text-fg-muted">{s.device}</div>}
      </div>
      <Button size="sm" variant="outline" loading={busy} onClick={open} aria-label={s.live ? 'Regarder en direct' : 'Revoir la session'}>
        <HugeiconsIcon icon={PlayCircleIcon} size={14} aria-hidden="true" />
        {s.live ? 'Regarder' : 'Revoir'}
      </Button>
    </li>
  );
}

export function MemberSessionsPanel({ memberId }: { memberId: string }) {
  const perms = usePermissions();
  const [shown, setShown] = useState(false);
  const q = useQuery({ queryKey: ['member-sessions', memberId], queryFn: () => membersApi.sessions(memberId), enabled: shown, staleTime: 15_000 });
  if (!perms.has('replay.read')) return null;
  const sessions = [...(q.data?.live ?? []), ...(q.data?.recorded ?? [])];

  return (
    <Panel>
      <PanelHeader
        title="Sessions"
        description="Ce que le membre a fait dans l’app (30 derniers jours). Mots de passe et codes jamais enregistrés ; chaque ouverture est notée."
        actions={shown
          ? <Button size="sm" variant="ghost" loading={q.isFetching} onClick={() => void q.refetch()}>Actualiser</Button>
          : <Button size="sm" variant="outline" onClick={() => setShown(true)}>Afficher</Button>}
      />
      <PanelBody>
        {shown && q.isLoading && <Skeleton className="h-16 w-full" />}
        {shown && q.isError && <p className="text-sm text-danger">{errorMessage(q.error, 'Sessions indisponibles.')}</p>}
        {shown && q.data && (sessions.length
          ? <ul className="divide-y divide-line">{sessions.map((s) => <SessionRow key={s.sessionId} memberId={memberId} s={s} />)}</ul>
          : <p className="text-sm text-fg-muted">Aucune session enregistrée ces 30 derniers jours.</p>)}
        <AssistButton memberId={memberId} className={shown ? 'mt-4 border-t border-line pt-4' : ''} />
      </PanelBody>
    </Panel>
  );
}
