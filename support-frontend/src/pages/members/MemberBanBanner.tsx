import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { membersApi } from '../../api/members';
import type { SupportMember } from '../../api/types';
import { usePermissions } from '../../auth/context';
import { useReauth } from '../../auth/reauth';
import { ReasonDialog } from '../../components/ReasonDialog';
import { toast } from '../../components/toast';
import { Button } from '../../components/ui';
import { formatDateTime, formatMoney } from '../../lib/format';

/**
 * « Compte suspendu » (2026-11-23): a member with no filleul asked for a withdrawal while holding
 * money the ledger cannot explain, and was suspended on the spot (signed out, no sign-in, no
 * withdrawal). Everyone who opens the card sees it; the figures behind it only reach money readers.
 * « Lever la suspension »: members.unban (finance managers, support administrators, super managers),
 * a reason and the authenticator code; done at once and audited.
 */
const REASON_MIN = 20;
const REASON_LABEL: Record<string, string> = {
  no_referral_withdrawal: 'retrait demandé sans aucun filleul, avec un argent que les mouvements n’expliquent pas',
  manual: 'suspension manuelle',
};
const WHY: Record<string, string> = {
  unexplained_balance: 'solde plus élevé que ce que ses mouvements expliquent',
  commission_without_referrals: 'commissions de parrainage reçues sans aucun filleul',
};
const money = (v: number | null | undefined, c?: string | null) => (v == null ? '—' : formatMoney(v, c === 'USD' ? 'USD' : 'XAF'));

export function MemberBanBanner({ member: m }: { member: SupportMember }) {
  const perms = usePermissions();
  const reauth = useReauth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ban = m.ban;
  if (!ban) return null;
  const d = ban.details ?? null;
  const ev = d?.evaluation ?? null;
  const unexplained = (ev?.balances ?? []).filter(b => b.unexplained);
  const canUnban = perms.has('members.unban');

  return (
    <section role="alert" aria-label="Compte suspendu" className="mb-4 rounded-control border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-base font-semibold">Compte suspendu</p>
          <p>
            Depuis le {formatDateTime(ban.at)} : {REASON_LABEL[ban.reason] ?? ban.reason}. Le membre est déconnecté et ne peut ni se
            connecter ni retirer.
          </p>
          {d?.reasons && d.reasons.length > 0 && (
            <ul className="list-disc pl-5">
              {d.reasons.map(r => <li key={r}>{WHY[r] ?? r}</li>)}
            </ul>
          )}
          {ev && (
            <dl className="mt-1 grid grid-cols-1 gap-x-6 gap-y-1 text-fg sm:grid-cols-2">
              {(unexplained.length ? unexplained : [{ currency: ev.currency ?? 'XAF', a: ev.a ?? 0, b: ev.b ?? null }]).map(b => (
                <div key={b.currency}>
                  <dt className="text-xs text-fg-muted">Solde {b.currency} : A (compte) / B (mouvements)</dt>
                  <dd>{money(b.a, b.currency)} / {money(b.b, b.currency)}</dd>
                </div>
              ))}
              {!!ev.commissionCredits && (
                <div>
                  <dt className="text-xs text-fg-muted">Commissions reçues (reprises)</dt>
                  <dd>{money(ev.commissionCredits)}{ev.commissionReversed ? ` (${money(ev.commissionReversed)})` : ''}</dd>
                </div>
              )}
              {d?.attempt?.amount != null && (
                <div>
                  <dt className="text-xs text-fg-muted">Retrait demandé</dt>
                  <dd>{d.attempt.amount} {d.attempt.currency ?? ''}</dd>
                </div>
              )}
            </dl>
          )}
        </div>
        {canUnban && (
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => setOpen(true)}>Lever la suspension</Button>
        )}
      </div>

      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title="Lever la suspension"
        description={`Pour ${m.name}. Le membre pourra de nouveau se connecter et retirer. Faites-le seulement après avoir vérifié d’où vient l’argent. L’action est enregistrée à votre nom.`}
        label="Ce que vous avez vérifié"
        minLength={REASON_MIN}
        confirmLabel="Lever la suspension"
        onConfirm={async reason => {
          const token = await reauth({ title: 'Confirmer la levée', description: 'Entrez le code de votre application d’authentification.' });
          const r = await membersApi.unban(m._id, reason, token);
          toast.success(r.stillBlocked ? 'Suspension levée. Le compte reste bloqué par l’administration.' : 'Suspension levée.');
          void qc.invalidateQueries({ queryKey: ['members', 'detail', m._id] });
        }}
      />
    </section>
  );
}
