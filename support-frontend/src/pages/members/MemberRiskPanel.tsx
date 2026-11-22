import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { membersApi } from '../../api/members';
import type { RiskCard } from '../../api/types';
import { Badge, Panel, PanelBody, PanelHeader, Skeleton } from '../../components/ui';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format';

/**
 * Security plan Phase 4 on the member page (finance managers, `risk.read`): the
 * fraud engine's score and what it would decide, why (links and referral rules;
 * recent events, each until its end date), the accounts linked to this one by a
 * number or a device, the shared numbers by their last 3 digits, the recent
 * events, and the KYC level 1 result. The engine is in observation mode: it
 * blocks nothing yet.
 */
const DECISION: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  allow: { label: 'Rien à signaler', tone: 'success' },
  require_code: { label: 'Vérification demandée', tone: 'warning' },
  hold: { label: 'Retrait à retenir', tone: 'danger' },
};
const DECISION_SHORT: Record<string, string> = { allow: 'OK', require_code: 'À vérifier', hold: 'À retenir' };

const EVENT: Record<string, string> = {
  signup: 'Inscription',
  contact_change: 'Changement de coordonnées',
  authenticator_change: 'Application d’authentification',
  dormant_reactivated: 'Retour d’un compte dormant',
  balance_mismatch: 'Écart entre les registres du solde',
  withdrawal_requested: 'Demande de retrait',
  payin_succeeded: 'Paiement reçu',
  automation_seen: 'Utilisation hors de l’application web',
};
const KIND: Record<string, string> = { email: 'e-mail', phone: 'téléphone', momo: 'Mobile Money', crypto: 'portefeuille crypto', setup: 'activée', reset: 'réinitialisée' };
const USES: Record<string, string> = { payout_number: 'retrait', profile_momo: 'Mobile Money du profil', payin_number: 'paiement', device: 'appareil' };

const KYC_BAND: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  low: { label: 'Faible', tone: 'success' }, medium: { label: 'Moyen', tone: 'warning' }, high: { label: 'Élevé', tone: 'danger' },
};
const KYC_REASON: Record<string, string> = {
  email_disposable: 'Adresse e-mail jetable',
  email_syntax: 'Adresse e-mail invalide',
  email_no_mx: 'Le domaine de l’e-mail ne reçoit pas de courrier',
  email_random: 'Adresse e-mail qui semble générée',
  email_variant_shared: 'Même boîte mail qu’un autre compte',
  phone_invalid: 'Numéro de téléphone invalide',
  momo_invalid: 'Numéro Mobile Money invalide',
  momo_operator_mismatch: 'Opérateur Mobile Money différent du numéro',
  phone_country_vs_declared: 'Numéro d’un autre pays que le pays déclaré',
  momo_country_vs_declared: 'Mobile Money d’un autre pays que le pays déclaré',
  network_country_elsewhere: 'Connecté depuis un autre pays',
};

export function MemberRiskPanel({ memberId }: { memberId: string }) {
  const q = useQuery({ queryKey: ['members', memberId, 'risk'], queryFn: () => membersApi.risk(memberId), retry: false });

  return (
    <Panel>
      <PanelHeader title="Risque" description="Moteur de fraude, en observation : il ne bloque encore rien." />
      <PanelBody className="space-y-4 text-sm">
        {q.isPending ? (
          <div className="space-y-2"><Skeleton className="h-5 w-48" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>
        ) : q.isError ? (
          <p role="alert" className="text-danger">Le moteur de fraude ne répond pas. Réessayez dans un instant.</p>
        ) : !q.data.available ? (
          <p className="text-fg-muted">Le moteur de fraude n’est pas encore relié au support.</p>
        ) : (
          <RiskBody card={q.data} />
        )}
      </PanelBody>
    </Panel>
  );
}

function RiskBody({ card }: { card: Extract<RiskCard, { available: true }> }) {
  const d = DECISION[card.decision] ?? DECISION.allow;
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-2xl font-semibold tabular-nums text-fg" data-testid="risk-score">{card.score}</span>
        <span className="text-xs text-fg-muted">points</span>
        <Badge tone={d.tone}>{d.label}</Badge>
        {card.scoredAt && <span className="text-xs text-fg-muted">calculé le {formatDateTime(card.scoredAt)}</span>}
      </div>

      {card.reasons.length > 0 ? (
        <ul className="space-y-1.5" aria-label="Raisons du score">
          {card.reasons.map(r => (
            <li key={`${r.rule}-${r.live}`} className="flex gap-2">
              <span className="w-10 shrink-0 text-right font-medium tabular-nums text-fg">+{r.points}</span>
              <span className="text-fg">
                {r.detail}
                {r.live && r.expiresAt && <span className="ml-1 text-xs text-fg-muted">(compte jusqu’au {formatDate(r.expiresAt)})</span>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-fg-muted">Aucune règle ne se déclenche pour ce membre.</p>
      )}

      {card.linked.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-fg-muted">Comptes liés par un numéro ou un appareil ({card.groupSize} en tout)</p>
          <ul className="space-y-1">
            {card.linked.map(l => (
              <li key={l.userId} className="flex flex-wrap items-center gap-2">
                <Link className="text-primary underline-offset-2 hover:underline" to={`/membres/${encodeURIComponent(l.userId)}`}>{l.name ?? l.userId}</Link>
                {l.country && <span className="text-xs text-fg-muted">{l.country}</span>}
                <Badge tone={l.decision === 'hold' ? 'danger' : l.decision === 'require_code' ? 'warning' : 'neutral'}>{l.score} · {DECISION_SHORT[l.decision] ?? l.decision}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      {card.identifiers.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-fg-muted">Partagés avec d’autres comptes</p>
          <ul className="space-y-1">
            {card.identifiers.map(i => (
              <li key={`${i.kind}-${i.tail}`} className="flex flex-wrap items-center gap-2">
                <span className="text-fg">{i.kind === 'device' ? 'Appareil' : 'Numéro'} •••{i.tail}</span>
                <span className="text-xs text-fg-muted">{i.uses.map(u => USES[u] ?? u).join(', ')} · {i.hub ? `plus de ${i.count - 1} comptes` : `${i.count} comptes`}</span>
                {i.hub && <Badge tone="outline">Trop partagé : ne lie pas les comptes</Badge>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {card.events.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-fg-muted">Derniers événements</p>
          <ul className="space-y-1">
            {card.events.slice(0, 8).map((e, n) => (
              <li key={`${e.type}-${e.at}-${n}`} className="flex flex-wrap gap-x-2">
                <span className="w-36 shrink-0 text-xs text-fg-muted">{formatDateTime(e.at)}</span>
                <span className="text-fg">
                  {EVENT[e.type] ?? e.type}
                  {e.kind && ` (${KIND[e.kind] ?? e.kind})`}
                  {e.amountXaf != null && e.amountXaf > 0 && ` · ${formatMoney(e.amountXaf)}`}
                  {e.numberTail && ` vers •••${e.numberTail}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="mb-1 text-xs text-fg-muted">Contrôle des coordonnées (KYC niveau 1)</p>
        {card.kyc ? (
          <div className="space-y-1">
            <p className="flex flex-wrap items-center gap-2">
              <Badge tone={(KYC_BAND[card.kyc.band] ?? KYC_BAND.low).tone}>Risque {(KYC_BAND[card.kyc.band] ?? KYC_BAND.low).label.toLowerCase()}</Badge>
              <span className="text-xs text-fg-muted">{card.kyc.score} points · vérifié le {formatDate(card.kyc.checkedAt)}{card.kyc.emailDomain ? ` · e-mail chez ${card.kyc.emailDomain}` : ''}</span>
            </p>
            {card.kyc.reasons.length > 0 && <ul className="list-inside list-disc text-fg">{card.kyc.reasons.map(r => <li key={r}>{KYC_REASON[r] ?? r}</li>)}</ul>}
          </div>
        ) : (
          <p className="text-fg-muted">Pas encore vérifié (le contrôle passe la nuit).</p>
        )}
      </div>
    </>
  );
}
