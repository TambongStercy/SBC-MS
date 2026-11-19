import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { financeApi } from '../../api/finance';
import { ApiError, errorMessage } from '../../api/http';
import { isReauthCancelled, useReauth } from '../../auth/reauth';
import { toast } from '../../components/toast';
import { Button, Dialog, DialogContent, Field, Segmented, Textarea } from '../../components/ui';
import { formatMoney } from '../../lib/format';

export interface RegularizationTarget {
  transactionId: string;
  amount?: number;
  currency?: string;
  memberName?: string;
  caseId?: string;
}

/** Evidence: one reference or link per line, blanks dropped. */
export const parseEvidence = (text: string) => text.split('\n').map(l => l.trim()).filter(Boolean);

/**
 * Regularization request on a withdrawal (complete or fail). It never acts
 * directly: it creates an approval that a finance manager must validate.
 */
export function RegularizationDialog({ target, onOpenChange }: {
  target: RegularizationTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const reauth = useReauth();
  const qc = useQueryClient();
  const [action, setAction] = useState<'complete' | 'fail'>('complete');
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target) { setAction('complete'); setReason(''); setEvidence(''); setError(''); }
  }, [target]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!target) return;
    setError('');
    const items = parseEvidence(evidence);
    if (reason.trim().length < 10) { setError('Écrivez un motif d’au moins 10 caractères.'); return; }
    if (items.length === 0) { setError('Ajoutez au moins une preuve (référence prestataire, lien vers la capture…).'); return; }
    setBusy(true);
    try {
      const token = await reauth({ title: 'Demander une régularisation', description: 'Action sensible : entrez le code de votre application pour envoyer la demande.' });
      await financeApi.requestRegularization(
        target.transactionId,
        { action, reason: reason.trim(), evidence: items, ...(target.caseId ? { caseId: target.caseId } : {}) },
        token,
      );
      toast.success('Demande envoyée. Un responsable financier doit la valider dans Approbations.');
      void qc.invalidateQueries({ queryKey: ['approvals'] });
      onOpenChange(false);
    } catch (err) {
      if (isReauthCancelled(err)) return;
      setError(err instanceof ApiError && err.code === 'STATE_CHANGED'
        ? 'Le retrait a changé d’état entre-temps. Rechargez la liste avant de demander une régularisation.'
        : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      {target && (
        <DialogContent
          title="Demander une régularisation"
          description={<>Retrait <span className="font-mono">{target.transactionId}</span>{target.amount != null && <> · {formatMoney(target.amount, target.currency)}</>}{target.memberName && <> · {target.memberName}</>}</>}
        >
          <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label="Demande de régularisation">
            {error && <p role="alert" className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-fg">Action demandée</span>
              <Segmented
                label="Action demandée"
                value={action}
                onValueChange={setAction}
                fill
                size="lg"
                options={[{ value: 'complete', label: 'Marquer réussi' }, { value: 'fail', label: 'Marquer échoué' }]}
              />
              <p className="text-xs text-fg-muted">
                {action === 'complete'
                  ? 'Réussi : le prestataire a payé le membre. Les fonds réservés sont débités du solde.'
                  : 'Échoué : le prestataire confirme l’échec. Les fonds réservés sont libérés. Une annulation demandée n’est pas une annulation confirmée : tant que le prestataire n’a pas confirmé, les fonds restent réservés.'}
              </p>
            </div>
            <Field label="Motif" required>
              <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} />
            </Field>
            <Field label="Preuves" required help="Une référence ou un lien par ligne (référence prestataire, capture du tableau de bord…).">
              <Textarea value={evidence} onChange={e => setEvidence(e.target.value)} rows={3} className="font-mono text-xs" />
            </Field>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
              <Button type="submit" variant="primary" loading={busy}>Envoyer la demande</Button>
            </div>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
