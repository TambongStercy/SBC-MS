import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IdVerifiedIcon } from '@hugeicons/core-free-icons';
import { identityApi, type IdentityDetail, type IdentityImageKind, type IdentityRow, type IdentityStatus } from '../../api/identity';
import { useReauth } from '../../auth/reauth';
import { ErrorState } from '../../components/display/ErrorState';
import { ReasonDialog } from '../../components/ReasonDialog';
import { toast } from '../../components/toast';
import { Badge, Button, EmptyState, PageHeader, Panel, PanelBody, PanelHeader, Segmented, Skeleton } from '../../components/ui';
import { formatDateTime, formatRelative } from '../../lib/format';

/**
 * KYC level 3 (2026-11-22): an ID document + selfie, asked when the fraud engine holds a member,
 * when the authenticator's phone is lost, or when someone lost access to their account. Any
 * support agent decides. The automatic checks are hints; the agent looks at the photos. Approving
 * proves identity only: the release, the reset or the contact change is still its own request.
 */
const STATUS: Record<IdentityStatus, { label: string; tone: 'neutral' | 'info' | 'success' | 'danger' }> = {
  pending: { label: 'Contrôle en cours', tone: 'neutral' },
  checked: { label: 'À examiner', tone: 'info' },
  approved: { label: 'Acceptée', tone: 'success' },
  refused: { label: 'Refusée', tone: 'danger' },
};
const KIND_LABEL: Record<IdentityImageKind, string> = { id_front: 'Pièce (recto)', id_back: 'Pièce (verso)', selfie: 'Selfie' };
type Filter = 'open' | 'approved' | 'refused';

const matchText = (s: number | null) => (s == null ? null : `Ressemblance ${Math.round(s * 100)} %`);

export default function IdentityPage() {
  const { id } = useParams();
  return id ? <IdentityReview id={id} /> : <IdentityList />;
}

function IdentityList() {
  const [filter, setFilter] = useState<Filter>('open');
  const q = useQuery({ queryKey: ['identity', filter], queryFn: () => identityApi.list(filter), refetchInterval: 30_000 });
  return (
    <>
      <PageHeader
        title="Identités"
        description="Pièces d’identité et selfies envoyés par les membres (compte retenu, téléphone perdu, accès perdu). Les contrôles automatiques sont des indices : c’est vous qui décidez, en regardant les photos."
      />
      <Segmented label="Afficher" value={filter} onValueChange={setFilter} className="mb-4"
        options={[{ value: 'open', label: 'À traiter' }, { value: 'approved', label: 'Acceptées' }, { value: 'refused', label: 'Refusées' }]} />
      {q.isLoading ? (
        <div className="flex flex-col gap-3" aria-busy="true">{[0, 1, 2].map(i => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching} />
      ) : !q.data?.length ? (
        <Panel><EmptyState icon={IdVerifiedIcon} title={filter === 'open' ? 'Rien à examiner' : 'Aucune vérification'} description="Les nouvelles vérifications apparaissent ici." /></Panel>
      ) : (
        <ul className="flex flex-col gap-3">{q.data.map(r => <li key={r.id}><Row row={r} /></li>)}</ul>
      )}
    </>
  );
}

function Row({ row }: { row: IdentityRow }) {
  const s = STATUS[row.status];
  return (
    <Link to={`/identites/${row.id}`} className="block rounded-xl border border-border bg-surface-1 p-4 transition-colors hover:bg-surface-2 focus-visible:outline-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{row.name ?? 'Sans nom'}</span>
        {row.guest && <Badge tone="warning">Sans compte</Badge>}
        {row.country && <Badge>{row.country}</Badge>}
        <Badge tone={s.tone}>{s.label}</Badge>
        <span className="ml-auto text-xs text-fg-muted" title={formatDateTime(row.submittedAt)}>{formatRelative(row.submittedAt)}</span>
      </div>
      <p className="mt-1 text-sm text-fg-muted">{row.purposeLabel}{row.matchScore != null ? ` · ${matchText(row.matchScore)}` : ''}</p>
      {row.hints.length > 0 && <p className="mt-1 text-sm text-warning">{row.hints.length} indice{row.hints.length > 1 ? 's' : ''} à regarder</p>}
    </Link>
  );
}

function IdentityReview({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['identity', 'one', id], queryFn: () => identityApi.get(id), retry: false });
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title="Vérification d’identité"
        actions={<Button variant="ghost" onClick={() => navigate('/identites')}>Retour à la liste</Button>}
      />
      {q.isLoading ? <Skeleton className="h-96 w-full" />
        : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching} />
          : q.data ? <Review v={q.data} /> : null}
    </>
  );
}

function Review({ v }: { v: IdentityDetail }) {
  const reauth = useReauth();
  const qc = useQueryClient();
  const [deciding, setDeciding] = useState<null | 'approved' | 'refused'>(null);
  const open = v.status === 'pending' || v.status === 'checked';
  const s = STATUS[v.status];
  const c = v.checks;

  const decide = async (decision: 'approved' | 'refused', reason: string) => {
    const token = await reauth({ title: decision === 'approved' ? 'Accepter l’identité' : 'Refuser l’identité', description: 'Entrez le code de votre application d’authentification.' });
    await identityApi.decide(v.id, decision, reason, token);
    toast.success(decision === 'approved' ? 'Identité acceptée. Le membre est prévenu.' : 'Vérification refusée. Le membre est prévenu.');
    await qc.invalidateQueries({ queryKey: ['identity'] });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Panel>
        <PanelHeader title="Photos" description={v.imagesDeletedAt
          ? `Supprimées le ${formatDateTime(v.imagesDeletedAt)} (30 jours après la décision).`
          : v.imagesDeleteAt ? `Supprimées automatiquement le ${formatDateTime(v.imagesDeleteAt)}.` : 'Chaque ouverture d’une photo est enregistrée dans le journal.'} />
        <PanelBody>
          {v.imagesDeletedAt ? <p className="text-sm text-fg-muted">Les photos ne sont plus conservées. La décision et ses motifs restent 12 mois.</p> : (
            <div className="grid gap-3 sm:grid-cols-2">
              {(['id_front', 'id_back', 'selfie'] as IdentityImageKind[]).filter(k => v.images.includes(k)).map(k => <Photo key={k} id={v.id} kind={k} />)}
            </div>
          )}
        </PanelBody>
      </Panel>

      <div className="flex flex-col gap-4">
        <Panel>
          <PanelHeader title={v.name ?? 'Sans nom'} description={v.purposeLabel} />
          <PanelBody className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge tone={s.tone}>{s.label}</Badge>
              {v.guest && <Badge tone="warning">Sans compte, non vérifié</Badge>}
              {v.country && <Badge>{v.country}</Badge>}
            </div>
            <p className="text-fg-muted">Envoyée le {formatDateTime(v.submittedAt)}</p>
            {v.memberId && <p><Link className="underline" to={`/membres/${v.memberId}`}>Ouvrir la fiche du membre</Link></p>}
            {v.ticketId && <p><Link className="underline" to={`/tickets/${v.ticketId}`}>Ouvrir la conversation</Link></p>}
            {v.decidedAt && (
              <div className="rounded-lg bg-surface-2 p-3">
                <p>{v.status === 'approved' ? 'Acceptée' : 'Refusée'} par {v.decidedBy?.name ?? '—'}, le {formatDateTime(v.decidedAt)}</p>
                {v.decisionReason && <p className="mt-1 text-fg-muted">{v.decisionReason}</p>}
              </div>
            )}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Contrôles automatiques" description="Des indices, pas une décision." />
          <PanelBody className="space-y-2 text-sm">
            {!c ? <p className="text-fg-muted">Contrôle en cours (quelques secondes)…</p> : (
              <>
                {c.match && (
                  <p>
                    <Badge tone={c.match.same ? 'success' : 'danger'}>{c.match.same ? 'Même personne probable' : 'Visages différents ?'}</Badge>{' '}
                    <span className="text-fg-muted">{matchText(c.match.score)} (seuil {Math.round(c.match.threshold * 100)} %)</span>
                  </p>
                )}
                {v.hints.length === 0 ? <p className="text-success">Aucun indice particulier.</p> : (
                  <ul className="list-disc space-y-1 pl-5">{v.hints.map(h => <li key={h.code}>{h.text}</li>)}</ul>
                )}
                {c.sameFaceOtherPeople.length > 0 && (
                  <div>
                    <p className="font-medium">Même visage, autre compte :</p>
                    <ul className="pl-1">
                      {c.sameFaceOtherPeople.map((o, i) => (
                        <li key={i}>
                          {o.memberId ? <Link className="underline" to={`/membres/${o.memberId}`}>Membre …{o.memberId.slice(-6)}</Link> : o.guest ? 'Demande sans compte' : 'Autre demande'}
                          <span className="text-fg-muted"> · {matchText(o.score)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </PanelBody>
        </Panel>

        {open && (
          <Panel>
            <PanelBody className="space-y-3 text-sm">
              <p className="text-fg-muted">Vérifiez que la pièce est lisible et valide, que le selfie montre la même personne, et que le nom correspond au compte. Accepter ne débloque rien : la libération ou la réinitialisation se demande ensuite depuis la fiche du membre.</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button className="flex-1" onClick={() => setDeciding('approved')}>Accepter</Button>
                <Button className="flex-1" variant="danger" onClick={() => setDeciding('refused')}>Refuser</Button>
              </div>
            </PanelBody>
          </Panel>
        )}
      </div>

      <ReasonDialog
        open={deciding !== null}
        onOpenChange={o => { if (!o) setDeciding(null); }}
        title={deciding === 'approved' ? 'Accepter cette identité' : 'Refuser cette vérification'}
        description={deciding === 'approved' ? 'Notez ce que vous avez vérifié (pièce, nom, selfie).' : 'Notez pourquoi : le membre sera invité à renvoyer des photos si besoin.'}
        label="Ce que vous avez vérifié"
        minLength={10}
        confirmLabel={deciding === 'approved' ? 'Accepter' : 'Refuser'}
        tone={deciding === 'refused' ? 'danger' : 'primary'}
        onConfirm={reason => decide(deciding!, reason)}
      />
    </div>
  );
}

function Photo({ id, kind }: { id: string; kind: IdentityImageKind }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl: string | null = null;
    let alive = true;
    identityApi.image(id, kind)
      .then(b => { objectUrl = URL.createObjectURL(b); if (alive) setUrl(objectUrl); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, kind]);
  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="text-xs font-medium text-fg-muted">{KIND_LABEL[kind]}</figcaption>
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-2">
        {failed ? <p className="p-2 text-center text-sm text-danger">Photo indisponible.</p>
            : url ? <a href={url} target="_blank" rel="noreferrer" className="h-full w-full"><img src={url} alt={KIND_LABEL[kind]} className="h-full w-full object-contain" /></a>
              : <Skeleton className="h-full w-full" />}
      </div>
    </figure>
  );
}
