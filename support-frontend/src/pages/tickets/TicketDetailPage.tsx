import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft01Icon, PlayCircleIcon, UserAdd01Icon } from '@hugeicons/core-free-icons';
import { errorMessage } from '../../api/http';
import { ticketsApi } from '../../api/tickets';
import type { Ticket, TicketEvent, TicketPriority, TicketStatus } from '../../api/types';
import { useAgent, usePermissions } from '../../auth/context';
import { ErrorState } from '../../components/display/ErrorState';
import { StatusBadge, TICKET_PRIORITY, TICKET_STATUS } from '../../components/display/labels';
import { ReasonDialog } from '../../components/ReasonDialog';
import { toast } from '../../components/toast';
import { Badge, Button, Field, Panel, PanelBody, PanelHeader, Select, Skeleton } from '../../components/ui';
import { formatDateTime, formatRelative } from '../../lib/format';
import { Composer } from './Composer';
import { Conversation } from './Conversation';
import { categoryLabel, SlaText } from './shared';
import { livePoll, useRealtimeConnected } from '../../realtime/realtime';

const SOURCE_LABEL: Record<Ticket['source'], string> = { member: 'Membre', assistant: 'Assistant', system: 'Système', agent: 'Agent', public: 'Formulaire sans compte' };
const UNASSIGNED = 'none';

/** One ticket: conversation and composer; status, assignment and history beside (below on phones). */
export default function TicketDetailPage() {
  const { id = '' } = useParams();
  const perms = usePermissions();
  // The member's replies show up within seconds while the ticket is open on screen
  // (polling pauses in a hidden tab, and stops once the ticket is closed).
  const live = useRealtimeConnected();
  const q = useQuery({
    queryKey: ['tickets', 'detail', id],
    queryFn: () => ticketsApi.get(id),
    // LiveKit signals reload it at once; polling is the fallback (every 5 s without the connection).
    refetchInterval: query => (query.state.data?.ticket.status === 'closed' ? false : livePoll(live, 5_000)),
  });

  if (q.isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching} />;

  const { ticket, messages, events } = q.data;
  return (
    <>
      <Link to="/tickets" className="mb-3 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
        <HugeiconsIcon icon={ArrowLeft01Icon} size={16} aria-hidden="true" /> Tickets
      </Link>
      <header className="mb-5">
        <p className="font-mono text-xs text-fg-muted">{ticket.number}</p>
        <h1 className="mt-0.5 break-words text-xl font-semibold tracking-tight text-fg sm:text-2xl">{ticket.subject}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge map={TICKET_STATUS} value={ticket.status} />
          <StatusBadge map={TICKET_PRIORITY} value={ticket.priority} />
          <Badge tone="outline">{categoryLabel(ticket.category)}</Badge>
          <span className="text-fg-muted">
            {perms.has('members.read') && ticket.member.id ? (
              <Link to={`/membres/${encodeURIComponent(ticket.member.id)}`} className="font-medium text-primary underline-offset-4 hover:underline">{ticket.member.name}</Link>
            ) : <span className="font-medium text-fg">{ticket.member.name}</span>}
            {' · '}ouvert {formatRelative(ticket.createdAt)}
          </span>
          <span className="text-fg-muted">Échéance : <SlaText due={ticket.slaDueAt} status={ticket.status} /></span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Conversation ticketId={ticket.id} messages={messages} guest={!ticket.member.id} />
          {perms.has('tickets.reply') ? <Composer ticket={ticket} /> : (
            <p className="rounded-panel border border-line bg-surface-2 px-4 py-3 text-sm text-fg-muted">Votre rôle permet de lire ce ticket, pas d’y répondre.</p>
          )}
        </div>
        <aside className="flex min-w-0 flex-col gap-4" aria-label="Gestion du ticket">
          <StatusPanel key={ticket.status} ticket={ticket} canChange={perms.has('tickets.reply')} />
          <AssignPanel ticket={ticket} canAssign={perms.has('tickets.assign')} canChangePriority={perms.has('tickets.assign')} />
          {ticket.contact && <ContactPanel ticket={ticket} />}
          <DetailsPanel ticket={ticket} />
          <EventsPanel events={events} />
        </aside>
      </div>
    </>
  );
}

function useTicketMutation<T>(fn: (v: T) => Promise<unknown>, success: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(success);
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: e => toast.error(errorMessage(e)),
  });
}

function StatusPanel({ ticket, canChange }: { ticket: Ticket; canChange: boolean }) {
  const [next, setNext] = useState<TicketStatus>(ticket.status);
  const [askReason, setAskReason] = useState(false);
  const mutation = useTicketMutation((v: { status: TicketStatus; reason?: string }) => ticketsApi.setStatus(ticket.id, v.status, v.reason), 'Statut mis à jour.');
  const finalStatus = next === 'resolved' || next === 'closed';

  const apply = () => {
    if (next === ticket.status) return;
    if (finalStatus) setAskReason(true);
    else mutation.mutate({ status: next });
  };

  return (
    <Panel>
      <PanelHeader title="Statut" />
      <PanelBody className="flex flex-col gap-3">
        <Field label="Nouveau statut">
          <Select
            value={next}
            onValueChange={v => setNext(v as TicketStatus)}
            disabled={!canChange}
            options={Object.entries(TICKET_STATUS).map(([value, s]) => ({ value, label: s.label }))}
          />
        </Field>
        <Button variant="primary" onClick={apply} disabled={!canChange || next === ticket.status} loading={mutation.isPending}>Appliquer</Button>
      </PanelBody>
      <ReasonDialog
        open={askReason}
        onOpenChange={setAskReason}
        title={next === 'closed' ? 'Fermer le ticket' : 'Marquer comme résolu'}
        description={next === 'resolved' ? 'Le ticket se fermera tout seul après quelques jours sans réponse du membre.' : undefined}
        label="Commentaire (facultatif)"
        required={false}
        confirmLabel="Confirmer"
        onConfirm={async reason => { await mutation.mutateAsync({ status: next, reason: reason || undefined }); }}
      />
    </Panel>
  );
}

function AssignPanel({ ticket, canAssign, canChangePriority }: { ticket: Ticket; canAssign: boolean; canChangePriority: boolean }) {
  const agent = useAgent();
  const assignees = useQuery({ queryKey: ['tickets', 'assignees'], queryFn: ticketsApi.assignees, enabled: canAssign, staleTime: 5 * 60_000 });
  const assign = useTicketMutation((agentId: string | null) => ticketsApi.assign(ticket.id, agentId), 'Attribution mise à jour.');
  const priority = useTicketMutation((p: TicketPriority) => ticketsApi.setPriority(ticket.id, p), 'Priorité mise à jour.');
  const current = ticket.assignee?.id ?? UNASSIGNED;
  const options = [
    { value: UNASSIGNED, label: 'Sans agent' },
    ...(assignees.data ?? []).map(a => ({ value: a.id, label: a.id === agent.id ? `${a.name} (moi)` : a.name })),
  ];
  // Keep the current agent selectable even if the list does not include them.
  if (ticket.assignee && !options.some(o => o.value === ticket.assignee!.id)) options.push({ value: ticket.assignee.id, label: ticket.assignee.name });

  return (
    <Panel>
      <PanelHeader title="Attribution" />
      <PanelBody className="flex flex-col gap-3">
        <p className="text-sm text-fg">
          {ticket.assignee ? <>Suivi par <span className="font-medium">{ticket.assignee.name}</span></> : <span className="text-fg-muted">Aucun agent ne suit ce ticket.</span>}
        </p>
        {canAssign && (
          <>
            <Field label="Attribuer à">
              <Select value={current} onValueChange={v => { if (v !== current) assign.mutate(v === UNASSIGNED ? null : v); }} options={options} disabled={assign.isPending} />
            </Field>
            {ticket.assignee?.id !== agent.id && (
              <Button variant="outline" onClick={() => assign.mutate(agent.id)} loading={assign.isPending}>
                <HugeiconsIcon icon={UserAdd01Icon} size={16} aria-hidden="true" /> Me l’attribuer
              </Button>
            )}
          </>
        )}
        {canChangePriority && (
          <Field label="Priorité">
            <Select
              value={ticket.priority}
              onValueChange={v => { if (v !== ticket.priority) priority.mutate(v as TicketPriority); }}
              options={Object.entries(TICKET_PRIORITY).map(([value, p]) => ({ value, label: p.label }))}
              disabled={priority.isPending}
            />
          </Field>
        )}
      </PanelBody>
    </Panel>
  );
}

/**
 * What the person typed to be reached. Without an account nothing proves who wrote:
 * the agent must not disclose any account detail and replies go to the email typed.
 */
function ContactPanel({ ticket }: { ticket: Ticket }) {
  const c = ticket.contact!;
  const guest = !ticket.member.id;
  return (
    <Panel>
      <PanelHeader title="Coordonnées" />
      <PanelBody>
        {guest && (
          <p role="note" className="mb-3 rounded-control border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-fg">
            <strong>Sans compte, non vérifié.</strong> N’importe qui peut écrire l’email ou le numéro d’un autre membre : ne donnez aucune information sur un compte. Vos réponses partent par email à l’adresse ci-dessous.
          </p>
        )}
        <dl className="space-y-2 text-sm">
          <ContactRow label="Nom" value={c.name} />
          <ContactRow label="Téléphone" value={c.phone} href={c.phone ? `tel:${c.phone.replace(/[^\d+]/g, '')}` : undefined} />
          <ContactRow label="Email" value={c.email} href={c.email ? `mailto:${c.email}` : undefined} />
        </dl>
        {!guest && <p className="mt-2 text-xs text-fg-muted">Indiquées par le membre dans sa demande (elles peuvent différer de son compte).</p>}
      </PanelBody>
    </Panel>
  );
}

function ContactRow({ label, value, href }: { label: string; value: string | null; href?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-all text-right text-fg">{value ? (href ? <a href={href} className="text-primary underline-offset-4 hover:underline">{value}</a> : value) : '—'}</dd>
    </div>
  );
}

function DetailsPanel({ ticket }: { ticket: Ticket }) {
  const rows: [string, string][] = [
    ['File', categoryLabel(ticket.queue || ticket.category)],
    ['Origine', SOURCE_LABEL[ticket.source] ?? ticket.source],
    ['Créé le', formatDateTime(ticket.createdAt)],
    ['Dernier message', formatDateTime(ticket.lastMessageAt ?? ticket.updatedAt)],
  ];
  return (
    <Panel>
      <PanelHeader title="Détails" />
      <PanelBody>
        <dl className="space-y-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3">
              <dt className="text-fg-muted">{k}</dt>
              <dd className="text-right text-fg">{v}</dd>
            </div>
          ))}
        </dl>
        {ticket.replay && <ReplayLink ticketId={ticket.id} at={ticket.replay.at} />}
      </PanelBody>
    </Panel>
  );
}

/**
 * Opens the member's OpenReplay session in a new tab. The tab is opened on the click
 * (browsers block a window opened after an await), then sent to the audited link.
 */
function ReplayLink({ ticketId, at }: { ticketId: string; at: string | null }) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    setBusy(true);
    try {
      const { url } = await ticketsApi.replayUrl(ticketId);
      if (tab) tab.location.href = url; else window.location.assign(url);
    } catch (e) {
      tab?.close();
      toast.error(errorMessage(e, 'Impossible d’ouvrir l’enregistrement.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 border-t border-line pt-4">
      <Button variant="outline" className="w-full" loading={busy} onClick={open}>
        <HugeiconsIcon icon={PlayCircleIcon} size={16} aria-hidden="true" />
        Revoir la session du membre
      </Button>
      <p className="mt-2 text-xs text-fg-muted">
        Ce que le membre a vu dans l’app avant et pendant sa demande{at ? ` (envoyée le ${formatDateTime(at)})` : ''}. Les mots de passe et les codes ne sont jamais enregistrés. Chaque ouverture est notée dans le journal.
      </p>
    </div>
  );
}

function eventText(e: TicketEvent): string {
  const status = (s?: string | null) => (s ? TICKET_STATUS[s as TicketStatus]?.label ?? s : '—');
  switch (e.type) {
    case 'created': return 'Ticket créé';
    case 'status': return `Statut : ${status(e.from)} → ${status(e.to)}`;
    case 'assign': return e.to ? `Attribué à ${e.toName || 'un agent'}` : 'Attribution retirée';
    case 'priority': return `Priorité : ${TICKET_PRIORITY[e.to as TicketPriority]?.label ?? e.to ?? '—'}`;
    case 'sla_breached': return 'Délai de réponse dépassé';
    default: return e.type;
  }
}

function EventsPanel({ events }: { events: TicketEvent[] }) {
  return (
    <Panel>
      <PanelHeader title="Historique" />
      <PanelBody>
        {events.length === 0 ? <p className="text-sm text-fg-muted">Rien pour l’instant.</p> : (
          <ol className="space-y-3 border-l border-line pl-4">
            {[...events].reverse().map(e => (
              <li key={e.id} className="relative text-sm">
                <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-line-strong" aria-hidden="true" />
                <p className="text-fg">{eventText(e)}</p>
                {e.reason && <p className="text-xs text-fg-muted">« {e.reason} »</p>}
                <p className="text-xs text-fg-subtle">{e.actor?.name ? `${e.actor.name} · ` : ''}<time dateTime={e.at} title={formatDateTime(e.at)}>{formatRelative(e.at)}</time></p>
              </li>
            ))}
          </ol>
        )}
      </PanelBody>
    </Panel>
  );
}
