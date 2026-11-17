import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { activationApi } from '../../api/activation';
import { ApiError, errorMessage } from '../../api/http';
import { isReauthCancelled, useReauth } from '../../auth/reauth';
import { toast } from '../../components/toast';
import { Button, Dialog, DialogContent, Field, Input, Select, Textarea } from '../../components/ui';

export const GATEWAYS = ['CinetPay', 'FeexPay', 'MoneyFusion', 'NOWPayments'] as const;
export const PLANS = [
  { value: 'CLASSIQUE', label: 'Classique' },
  { value: 'CIBLE', label: 'Ciblé' },
  { value: 'WINNER', label: 'Pack Winner' },
  { value: 'PRO', label: 'PRO' },
  { value: 'MISE_EN_AVANT', label: 'Mise en avant' },
];

/** French text for the refusals the server can give (CONTRACT §2.2 /activation/manual). */
export function manualActivationError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'REF_ALREADY_USED') return 'Cette référence a déjà servi à une activation. Une même référence ne peut pas activer deux fois.';
    if (e.code === 'PROVIDER_NOT_CONFIRMED') return 'Le prestataire ne confirme pas ce paiement. Vérifiez la référence et le prestataire : rien n’a été demandé.';
  }
  return errorMessage(e);
}

export interface ManualActivationDefaults {
  userId?: string;
  gateway?: string;
  externalRef?: string;
  caseId?: string;
}

/**
 * Manual activation request: verified at the provider by the server, then
 * waits for a second person (approval). Needs a reauth code.
 */
export function ManualActivationDialog({ open, onOpenChange, defaults }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaults?: ManualActivationDefaults;
}) {
  const reauth = useReauth();
  const qc = useQueryClient();
  const [userId, setUserId] = useState('');
  const [gateway, setGateway] = useState('');
  const [externalRef, setExternalRef] = useState('');
  const [plan, setPlan] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUserId(defaults?.userId ?? '');
    setGateway(defaults?.gateway && (GATEWAYS as readonly string[]).includes(defaults.gateway) ? defaults.gateway : '');
    setExternalRef(defaults?.externalRef ?? '');
    setPlan('');
    setReason('');
    setError('');
  }, [open, defaults]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!userId.trim() || !gateway || !externalRef.trim() || !plan) { setError('Remplissez le membre, le prestataire, la référence et l’offre.'); return; }
    if (reason.trim().length < 5) { setError('Écrivez un motif d’au moins 5 caractères.'); return; }
    setBusy(true);
    try {
      const token = await reauth({ title: 'Demander une activation manuelle', description: 'Action sensible : entrez le code de votre application pour envoyer la demande.' });
      await activationApi.requestManual(
        { userId: userId.trim(), gateway, externalRef: externalRef.trim(), plan, reason: reason.trim(), ...(defaults?.caseId ? { caseId: defaults.caseId } : {}) },
        token,
      );
      toast.success('Demande envoyée. Une deuxième personne doit la valider dans Approbations avant l’activation.');
      void qc.invalidateQueries({ queryKey: ['approvals'] });
      onOpenChange(false);
    } catch (err) {
      if (!isReauthCancelled(err)) setError(manualActivationError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Demande d’activation manuelle"
        description="Le serveur vérifie la référence chez le prestataire. L’activation n’a lieu qu’après validation par une autre personne."
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label="Demande d’activation manuelle">
          {error && <p role="alert" className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <Field label="Identifiant du membre" required>
            <Input value={userId} onChange={e => setUserId(e.target.value)} className="font-mono" autoComplete="off" />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Prestataire" required>
              <Select value={gateway} onValueChange={setGateway} placeholder="Choisir" options={GATEWAYS.map(g => ({ value: g, label: g }))} />
            </Field>
            <Field label="Offre" required>
              <Select value={plan} onValueChange={setPlan} placeholder="Choisir" options={PLANS} />
            </Field>
          </div>
          <Field label="Référence chez le prestataire" required help="La référence du paiement telle qu’elle apparaît chez le prestataire.">
            <Input value={externalRef} onChange={e => setExternalRef(e.target.value)} className="font-mono" autoComplete="off" />
          </Field>
          <Field label="Motif" required>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder="Ex. : paiement confirmé par le prestataire, activation jamais reçue." />
          </Field>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
            <Button type="submit" variant="primary" loading={busy}>Envoyer la demande</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
