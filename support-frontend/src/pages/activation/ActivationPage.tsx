import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { Search01Icon } from '@hugeicons/core-free-icons';
import { activationApi } from '../../api/activation';
import { errorMessage } from '../../api/http';
import type { RecheckResult } from '../../api/types';
import { useCan } from '../../auth/context';
import { RecheckResultCard } from '../../components/display/RecheckResultCard';
import { Button, Field, Input, PageHeader, Panel, PanelBody, PanelHeader, Segmented } from '../../components/ui';
import { CaseList } from '../cases/CaseList';
import { ManualActivationDialog } from '../cases/ManualActivationDialog';

type RefKind = 'sessionId' | 'reference';

/** Activation after payment: ask the provider again, follow the cases, request a manual activation. */
export default function ActivationPage() {
  const canManual = useCan('activation.manual.request');
  const [manualOpen, setManualOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Activation"
        description="Un membre a payé mais son compte n’est pas activé : revérifiez le paiement chez le prestataire, puis suivez les dossiers ouverts."
        actions={canManual ? <Button variant="primary" onClick={() => setManualOpen(true)}>Demande d’activation manuelle</Button> : undefined}
      />
      <div className="flex flex-col gap-6">
        <CheckPanel />
        <section aria-labelledby="activation-cases">
          <h2 id="activation-cases" className="mb-3 text-base font-semibold text-fg">Dossiers d’activation</h2>
          <CaseList scope="activation" />
        </section>
      </div>
      <ManualActivationDialog open={manualOpen} onOpenChange={setManualOpen} />
    </>
  );
}

function CheckPanel() {
  const [kind, setKind] = useState<RefKind>('sessionId');
  const [value, setValue] = useState('');
  const [userId, setUserId] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<RecheckResult | null>(null);

  const check = useMutation({
    mutationFn: () => activationApi.check({
      ...(kind === 'sessionId' ? { sessionId: value.trim() } : { reference: value.trim() }),
      ...(userId.trim() ? { userId: userId.trim() } : {}),
    }),
    onSuccess: r => setResult(r),
    onError: e => setError(errorMessage(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setResult(null);
    if (!value.trim()) { setError(kind === 'sessionId' ? 'Entrez l’identifiant de session du paiement.' : 'Entrez la référence du prestataire.'); return; }
    check.mutate();
  };

  return (
    <Panel>
      <PanelHeader title="Vérifier un paiement" description="Le serveur interroge le prestataire. Si le paiement est confirmé, l’activation normale est rejouée (une seule fois)." />
      <PanelBody>
        <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Vérifier un paiement">
          <Segmented
            label="Type de référence"
            value={kind}
            onValueChange={k => { setKind(k); setResult(null); }}
            options={[{ value: 'sessionId', label: 'Session SBC' }, { value: 'reference', label: 'Référence prestataire' }]}
          />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label={kind === 'sessionId' ? 'Identifiant de session' : 'Référence chez le prestataire'} error={error || undefined}>
              <Input value={value} onChange={e => setValue(e.target.value)} className="font-mono" autoComplete="off" />
            </Field>
            <Field label="Identifiant du membre (facultatif)" help="Si renseigné, le paiement doit appartenir à ce membre.">
              <Input value={userId} onChange={e => setUserId(e.target.value)} className="font-mono" autoComplete="off" />
            </Field>
          </div>
          <Button type="submit" variant="primary" className="self-start" loading={check.isPending}>
            <HugeiconsIcon icon={Search01Icon} size={16} aria-hidden="true" /> Vérifier
          </Button>
        </form>
        {result && <RecheckResultCard result={result} className="mt-4" />}
        {result && (result.result === 'not_found' || result.result === 'provider_unavailable') && (
          <p className="mt-3 text-sm text-fg-muted">Un dossier d’activation est ouvert automatiquement : il apparaît dans la liste ci-dessous.</p>
        )}
      </PanelBody>
    </Panel>
  );
}
