import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckmarkCircle02Icon, Key01Icon, RefreshIcon, SecurityLockIcon } from '@hugeicons/core-free-icons';
import { apiErrorMessage, getMySecurity, regenerateBackupCodes } from '../services/adminStaffApi';
import { Badge, Button, EmptyState, Field, Input, PageHeader, Panel, PanelBody, PanelHeader, Skeleton } from '../components/ui';

const KEY = ['admin-my-security'] as const;

/**
 * Sécurité du compte (every admin account): the authenticator app that signs
 * in to the admin, the backup codes left, and new backup codes (the old ones
 * stop working). A lost phone without backup codes: a super admin resets the
 * authenticator from Équipe.
 */
export default function SecurityPage() {
  const queryClient = useQueryClient();
  const security = useQuery({ queryKey: KEY, queryFn: getMySecurity });
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);

  const regenerate = useMutation({
    mutationFn: (c: string) => regenerateBackupCodes(c),
    onSuccess: list => {
      setCodes(list);
      setCode('');
      void queryClient.invalidateQueries({ queryKey: KEY });
    },
    onError: error => toast.error(apiErrorMessage(error, 'Code refusé. Attendez le code suivant et réessayez.')),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const c = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(c)) {
      toast.error('Entrez les 6 chiffres affichés par l’application.');
      return;
    }
    regenerate.mutate(c);
  };

  const copy = async () => {
    if (!codes) return;
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      toast.success('Codes copiés.');
    } catch {
      toast.error('La copie a échoué : notez-les.');
    }
  };

  const s = security.data;
  const left = s?.backupCodesLeft ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sécurité du compte"
        description="Votre connexion à l’administration : mot de passe, puis le code de l’application d’authentification."
        className="mb-0"
      />

      <Panel>
        <PanelHeader title="Application d’authentification" />
        <PanelBody>
          {security.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : security.isError ? (
            <EmptyState
              icon={RefreshIcon}
              title="L’état n’a pas pu être chargé"
              description={apiErrorMessage(security.error, 'Vérifiez la connexion, puis réessayez.')}
              action={<Button onClick={() => void security.refetch()} loading={security.isFetching}>Réessayer</Button>}
            />
          ) : (
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-fg-muted">Application</dt>
                <dd className="mt-1">{s?.authenticator ? <Badge tone="success">Activée</Badge> : <Badge tone="warning">Non configurée</Badge>}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">Codes de secours restants</dt>
                <dd className="mt-1 flex items-center gap-2 text-sm font-medium text-fg">
                  {left} sur 10 {left <= 3 && <Badge tone="danger">À renouveler</Badge>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">Dernière connexion</dt>
                <dd className="mt-1 text-sm text-fg">{s?.lastLoginAt ? new Date(s.lastLoginAt).toLocaleString('fr-FR') : '—'}</dd>
              </div>
            </dl>
          )}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader
          title={(
            <span className="flex items-center gap-2">
              <HugeiconsIcon icon={Key01Icon} size={18} aria-hidden="true" className="text-primary" />
              Nouveaux codes de secours
            </span>
          )}
          description="Les 10 anciens codes cessent de fonctionner. Chaque nouveau code remplace une fois le code de l’application."
        />
        <PanelBody>
          {codes ? (
            <div className="space-y-4">
              <div className="flex items-start gap-2 text-sm text-fg">
                <HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
                Notez-les maintenant, hors de votre téléphone : ils ne seront plus affichés.
              </div>
              <ul className="grid max-w-md grid-cols-2 gap-x-6 gap-y-1.5 rounded-control border border-line bg-surface-2 p-3 font-mono text-sm text-fg" data-openreplay-hidden="">
                {codes.map(c => <li key={c} className="select-all">{c}</li>)}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => void copy()}>Copier</Button>
                <Button variant="ghost" onClick={() => setCodes(null)}>C’est noté</Button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="flex max-w-md flex-col gap-3 sm:flex-row sm:items-end">
              <Field label="Code de l’application" className="flex-1">
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  placeholder="123456"
                  className="h-11 font-mono tracking-[0.3em]"
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  data-openreplay-hidden=""
                />
              </Field>
              <Button type="submit" variant="primary" size="lg" loading={regenerate.isPending} disabled={!s?.authenticator}>
                <HugeiconsIcon icon={SecurityLockIcon} size={18} aria-hidden="true" />
                Créer de nouveaux codes
              </Button>
            </form>
          )}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Téléphone perdu ou changé" />
        <PanelBody className="space-y-2 text-sm text-fg-muted">
          <p>Connectez-vous avec un code de secours, puis demandez à un super administrateur de réinitialiser votre application (Équipe).</p>
          <p>À la connexion suivante, un code vous est envoyé par email et vous configurez l’application sur le nouveau téléphone.</p>
        </PanelBody>
      </Panel>
    </div>
  );
}
