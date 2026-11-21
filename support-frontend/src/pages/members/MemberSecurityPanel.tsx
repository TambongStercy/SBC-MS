import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { membersApi } from '../../api/members';
import type { SupportMember } from '../../api/types';
import { usePermissions } from '../../auth/context';
import { useReauth } from '../../auth/reauth';
import { ReasonDialog } from '../../components/ReasonDialog';
import { toast } from '../../components/toast';
import { Badge, Button, Panel, PanelBody, PanelHeader } from '../../components/ui';
import { formatDateTime, formatMoney } from '../../lib/format';

/**
 * Security plan Phase 5 on the member page: where the member is (declared,
 * usual and last country), whether their money is frozen, balance A (account)
 * against B (opening + recorded movements), and the two requests support can
 * make about the account: remove a lost authenticator, freeze or unfreeze the
 * money. Each request is approved by another agent before anything happens.
 * Linked accounts and the risk score arrive with the fraud engine (Phase 4),
 * balance C with the second ledger (Phase 2).
 */
const regionNames = (() => { try { return new Intl.DisplayNames(['fr'], { type: 'region' }); } catch { return null; } })();
const country = (c: string | null | undefined) => (c ? `${regionNames?.of(c) ?? c} (${c})` : '—');
const REASON_MIN = 20;

export function MemberSecurityPanel({ member: m }: { member: SupportMember }) {
  const perms = usePermissions();
  const reauth = useReauth();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<'reset' | 'freeze' | null>(null);
  const canReset = perms.has('authenticator.reset.request');
  const canFreeze = perms.has('risk.decide');
  const geo = m.geo;
  const usualDiffers = geo?.usual && geo.declared && geo.usual !== geo.declared;
  const lastDiffers = geo?.last && geo.declared && geo.last !== geo.declared;

  const done = (msg: string) => {
    toast.success(msg);
    void qc.invalidateQueries({ queryKey: ['approvals'] });
    setDialog(null);
  };

  return (
    <Panel>
      <PanelHeader
        title="Sécurité"
        actions={(canReset || canFreeze) ? (
          <div className="flex flex-wrap gap-2">
            {canReset && <Button size="sm" variant="outline" onClick={() => setDialog('reset')}>Réinitialiser l’authentificateur</Button>}
            {canFreeze && (
              <Button size="sm" variant={m.frozen ? 'outline' : 'danger-ghost'} onClick={() => setDialog('freeze')}>
                {m.frozen ? 'Dégeler l’argent' : 'Geler l’argent'}
              </Button>
            )}
          </div>
        ) : undefined}
      />
      <PanelBody className="space-y-4 text-sm">
        {m.frozen && (
          <p role="status" className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-danger">
            Argent gelé depuis le {formatDateTime(m.frozen.at)}{m.frozen.reason ? ` : ${m.frozen.reason}` : ''}. Aucun retrait ni transfert jusqu’au dégel.
          </p>
        )}
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
          <div><dt className="text-xs text-fg-muted">Pays déclaré</dt><dd className="text-fg">{country(geo?.declared ?? m.country ?? null)}</dd></div>
          <div>
            <dt className="text-xs text-fg-muted">Pays habituel</dt>
            <dd className="text-fg">
              {geo?.usual ? <>{country(geo.usual)}{geo.usualShare != null && <span className="ml-1 text-xs text-fg-muted">{Math.round(geo.usualShare * 100)} % des jours</span>}</> : <span className="text-fg-muted">Pas encore assez de jours</span>}
              {usualDiffers && <Badge className="ml-1.5" tone="warning">Différent</Badge>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-fg-muted">Dernier pays</dt>
            <dd className="text-fg">
              {country(geo?.last)}{geo?.lastAt && <span className="ml-1 text-xs text-fg-muted">{formatDateTime(geo.lastAt)}</span>}
              {lastDiffers && <Badge className="ml-1.5" tone="warning">Différent</Badge>}
            </dd>
          </div>
        </dl>
        {m.momoNumber && (
          <p><span className="text-xs text-fg-muted">Mobile Money : </span><span className="text-fg">{m.momoNumber}</span>{m.momoOperator && <span className="ml-1 text-xs text-fg-muted">{m.momoOperator}</span>}</p>
        )}
        {m.ledger !== undefined && (
          <div>
            <p className="mb-1 text-xs text-fg-muted">Soldes : A (compte), B (ouverture + mouvements enregistrés), C (second registre, phase 2)</p>
            {m.ledger === null ? (
              <p className="text-fg-muted">Pas encore de solde d’ouverture pour ce membre.</p>
            ) : (
              <ul className="space-y-1">
                {m.ledger.map(l => (
                  <li key={l.currency} className="flex flex-wrap items-center gap-2">
                    <span className="w-10 text-xs text-fg-muted">{l.currency}</span>
                    <span>A {formatMoney(l.actual, l.currency)}</span>
                    <span>B {formatMoney(l.expected, l.currency)}</span>
                    <span className="text-fg-muted">C —</span>
                    {l.matches ? <Badge tone="success">A = B</Badge> : <Badge tone="danger">Écart {formatMoney(Math.round((l.actual - l.expected) * 100) / 100, l.currency)}</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <p className="text-xs text-fg-muted">Comptes liés et score de risque : arrivent avec le moteur de fraude (phase 4).</p>
      </PanelBody>

      <ReasonDialog
        open={dialog === 'reset'}
        onOpenChange={o => { if (!o) setDialog(null); }}
        title="Réinitialiser l’application d’authentification"
        description={`Pour ${m.name}, qui a perdu son téléphone. Vérifiez d’abord la pièce d’identité et un selfie. Un responsable financier doit valider ; ensuite l’application est retirée, les retraits sont bloqués 72 h et le membre est prévenu par e-mail.`}
        label="Vérification faite (pièce d’identité + selfie)"
        minLength={REASON_MIN}
        confirmLabel="Envoyer pour validation"
        onConfirm={async reason => {
          const token = await reauth({ title: 'Confirmer la demande', description: 'Entrez le code de votre application d’authentification.' });
          await membersApi.requestAuthenticatorReset(m._id, reason, token);
          done('Demande envoyée pour validation.');
        }}
      />
      <ReasonDialog
        open={dialog === 'freeze'}
        onOpenChange={o => { if (!o) setDialog(null); }}
        title={m.frozen ? 'Dégeler l’argent du membre' : 'Geler l’argent du membre'}
        description={m.frozen
          ? 'Les retraits et transferts redeviennent possibles après la validation d’un autre responsable financier.'
          : 'Tant que le gel dure, aucun retrait ni transfert ne sort du compte. Un autre responsable financier doit valider. Le membre n’est pas prévenu automatiquement.'}
        label="Motif"
        minLength={REASON_MIN}
        tone={m.frozen ? 'primary' : 'danger'}
        confirmLabel="Envoyer pour validation"
        onConfirm={async reason => {
          const token = await reauth({ title: 'Confirmer la demande', description: 'Entrez le code de votre application d’authentification.' });
          await membersApi.requestFreeze(m._id, m.frozen ? 'unfreeze' : 'freeze', reason, token);
          done('Demande envoyée pour validation.');
        }}
      />
    </Panel>
  );
}
