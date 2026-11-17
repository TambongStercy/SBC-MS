import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon, ArrowRight01Icon, CheckListIcon, Clock01Icon, Ticket01Icon, UserAdd01Icon, Video01Icon, ViewIcon } from '@hugeicons/core-free-icons';
import { approvalsApi } from '../api/approvals';
import { casesApi } from '../api/cases';
import { financeApi } from '../api/finance';
import { ticketsApi } from '../api/tickets';
import { viewsApi } from '../api/views';
import { useAgent, usePermissions } from '../auth/context';
import { Button, Metric, PageHeader, Panel, PanelBody, PanelHeader, Skeleton } from '../components/ui';
import { APPROVE_PERMISSIONS, hasAny, roleLabel } from '../lib/permissions';
import { formatNumber } from '../lib/format';
import { menuFor } from '../navigation/menu';

// A tile whose service is down says so instead of loading forever.
const n = (v: number | undefined, loading: boolean, failed = false) =>
  failed ? <span className="text-sm font-normal text-fg-muted" title="Service indisponible">indisponible</span>
    : loading ? <Skeleton className="h-7 w-12" /> : formatNumber(v);

/** Overview for the agent's roles: what is waiting for them, and where to go. */
export default function HomePage() {
  const agent = useAgent();
  const perms = usePermissions();
  const canTickets = perms.has('tickets.read');
  const canApprove = hasAny(perms, APPROVE_PERMISSIONS);
  const canFinance = perms.has('finance.read');
  const canCases = perms.has('cases.work');
  const canSupervise = perms.has('views.supervise');
  const canVerify = perms.has('views.verify');

  const mine = useQuery({ queryKey: ['home', 'tickets', 'mine'], queryFn: () => ticketsApi.list({ assignee: 'me', status: 'active', limit: 1 }), enabled: canTickets });
  const unassigned = useQuery({ queryKey: ['home', 'tickets', 'unassigned'], queryFn: () => ticketsApi.list({ assignee: 'unassigned', status: 'active', limit: 1 }), enabled: canTickets });
  const approvals = useQuery({ queryKey: ['approvals', 'pending'], queryFn: () => approvalsApi.list({ status: 'pending' }), enabled: canApprove });
  const summary = useQuery({ queryKey: ['finance', 'summary', {}], queryFn: () => financeApi.summary({}), enabled: canFinance });
  const cases = useQuery({ queryKey: ['home', 'cases'], queryFn: () => casesApi.list({ type: 'finance', status: 'active', limit: 1 }), enabled: canCases });
  const board = useQuery({ queryKey: ['views', 'board'], queryFn: viewsApi.board, enabled: canSupervise, refetchInterval: 30_000 });

  const toDecide = approvals.data?.filter(a => a.requestedBy.id !== agent.id).length;
  const bucket = (b: string) => summary.data?.ageBuckets.find(x => x.bucket === b)?.count;
  const groups = menuFor(perms).filter(g => g.id !== 'home');

  return (
    <>
      <PageHeader
        title={`Bonjour ${agent.name.split(' ')[0]}`}
        description={agent.roles.map(roleLabel).join(' · ')}
        actions={canVerify ? (
          <Button asChild variant="primary" size="lg">
            <Link to="/verifications"><HugeiconsIcon icon={Video01Icon} size={18} aria-hidden="true" /> Tâche suivante</Link>
          </Button>
        ) : undefined}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {canTickets && <>
          <Link to="/tickets?assignee=me" className="rounded-panel focus-visible:outline-2 focus-visible:outline-primary">
            <Metric label="Mes tickets en cours" value={n(mine.data?.total, mine.isLoading, mine.isError)} icon={Ticket01Icon} tone="primary" className="h-full hover:border-line-strong" />
          </Link>
          <Link to="/tickets?assignee=unassigned" className="rounded-panel focus-visible:outline-2 focus-visible:outline-primary">
            <Metric label="Tickets sans agent" value={n(unassigned.data?.total, unassigned.isLoading, unassigned.isError)} icon={UserAdd01Icon} className="h-full hover:border-line-strong" />
          </Link>
        </>}
        {canApprove && (
          <Link to="/approbations" className="rounded-panel focus-visible:outline-2 focus-visible:outline-primary">
            <Metric label="Approbations à donner" value={n(toDecide, approvals.isLoading, approvals.isError)} icon={CheckListIcon} tone={toDecide ? 'warning' : 'neutral'} className="h-full hover:border-line-strong" />
          </Link>
        )}
        {canFinance && <>
          <Link to="/finance?ageBucket=48-72h" className="rounded-panel focus-visible:outline-2 focus-visible:outline-primary">
            <Metric label="Retraits bloqués 48–72 h" value={n(bucket('48-72h'), summary.isLoading, summary.isError)} icon={Clock01Icon} tone={bucket('48-72h') ? 'warning' : 'neutral'} className="h-full hover:border-line-strong" />
          </Link>
          <Link to="/finance?ageBucket=%3E72h" className="rounded-panel focus-visible:outline-2 focus-visible:outline-primary">
            <Metric label="Retraits bloqués > 72 h" value={n(bucket('>72h'), summary.isLoading, summary.isError)} icon={Alert02Icon} tone={bucket('>72h') ? 'danger' : 'neutral'} className="h-full hover:border-line-strong" />
          </Link>
        </>}
        {canCases && (
          <Link to="/finance?tab=dossiers" className="rounded-panel focus-visible:outline-2 focus-visible:outline-primary">
            <Metric label="Dossiers finance ouverts" value={n(cases.data?.total, cases.isLoading, cases.isError)} icon={Alert02Icon} className="h-full hover:border-line-strong" />
          </Link>
        )}
        {canSupervise && <>
          <Link to="/supervision" className="rounded-panel focus-visible:outline-2 focus-visible:outline-primary">
            <Metric label="Preuves en attente" value={n(board.data?.counts.available, board.isLoading, board.isError)} icon={Video01Icon} className="h-full hover:border-line-strong" />
          </Link>
          <Link to="/supervision" className="rounded-panel focus-visible:outline-2 focus-visible:outline-primary">
            <Metric label="Alertes d’inactivité" value={n(board.data?.alerts.length, board.isLoading, board.isError)} icon={ViewIcon} tone={board.data?.alerts.length ? 'danger' : 'neutral'} className="h-full hover:border-line-strong" />
          </Link>
        </>}
      </div>

      <Panel className="mt-6">
        <PanelHeader title="Vos espaces" description="Les écrans ouverts à vos rôles." />
        <PanelBody>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {groups.flatMap(g => g.items).map(item => (
              <li key={item.path}>
                <Link to={item.path} className="group flex h-12 items-center gap-3 rounded-control border border-line px-3 text-sm text-fg hover:border-line-strong hover:bg-surface-2">
                  <HugeiconsIcon icon={item.icon} size={18} className="text-fg-subtle" aria-hidden="true" />
                  <span className="flex-1">{item.label}</span>
                  <HugeiconsIcon icon={ArrowRight01Icon} size={16} className="text-fg-subtle group-hover:text-fg" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </PanelBody>
      </Panel>
    </>
  );
}
