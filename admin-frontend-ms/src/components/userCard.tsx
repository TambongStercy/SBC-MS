import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon, FloppyDiskIcon, InformationCircleIcon } from '@hugeicons/core-free-icons';
import { type AdminUserData, PartnerPack, SubscriptionType, updateUser, updateUserRole } from '../services/adminUserApi';
import { ROLE_LABEL } from '../lib/roles';
import { usePermission } from '../hooks/usePermission';
import { Can } from './Can';
import ConfirmationModal from './common/ConfirmationModal';
import { Button, Field, Input, Panel, PanelBody, PanelHeader, Select } from './ui';
import { RoleBadge } from './members/shared';
import { COUNTRY_OPTIONS, countryLabel } from './members/filters';

type SubChoice = SubscriptionType.CLASSIQUE | SubscriptionType.CIBLE | 'NONE';
type PackChoice = 'silver' | 'gold' | 'none';

// Mobile Money operators per country (stored operator names).
type CountryCode = 'BJ' | 'CM' | 'BF' | 'CD' | 'KE' | 'NG' | 'SN' | 'CG' | 'GA' | 'CI';
const COUNTRY_OPERATORS: Record<CountryCode, string[]> = {
  BJ: ['MTN_MOMO_BEN', 'MOOV_BEN'],
  CM: ['MTN_MOMO_CMR', 'ORANGE_CMR'],
  BF: ['MOOV_BFA', 'ORANGE_BFA'],
  CD: ['VODACOM_MPESA_COD', 'AIRTEL_COD', 'ORANGE_COD'],
  KE: ['MPESA_KEN'],
  NG: ['MTN_MOMO_NGA', 'AIRTEL_NGA'],
  SN: ['FREE_SEN', 'ORANGE_SEN', 'WAVE_SEN'],
  CG: ['AIRTEL_COG', 'MTN_MOMO_COG'],
  GA: ['AIRTEL_GAB'],
  CI: ['MTN_MOMO_CIV', 'ORANGE_CIV', 'WAVE_CIV'],
};
const DIAL_TO_COUNTRY: Record<string, CountryCode> = {
  '229': 'BJ', '237': 'CM', '226': 'BF', '243': 'CD', '254': 'KE', '234': 'NG', '221': 'SN', '242': 'CG', '241': 'GA', '225': 'CI',
};
const isCountryCode = (c: string): c is CountryCode => c in COUNTRY_OPERATORS;

/** Country of the Mobile Money account: from the number's dialling code, else the operator, else the region, else the member's country, else Bénin. */
function momoCountryOf(momoNumber: string, operator?: string, region?: string, country?: string): CountryCode {
  const prefix = momoNumber.replace(/^\+/, '').slice(0, 3);
  if (DIAL_TO_COUNTRY[prefix]) return DIAL_TO_COUNTRY[prefix];
  if (operator) {
    const hit = (Object.entries(COUNTRY_OPERATORS) as [CountryCode, string[]][]).find(([, ops]) => ops.includes(operator));
    if (hit) return hit[0];
  }
  const r = region?.toUpperCase();
  if (r && isCountryCode(r)) return r;
  const c = country?.toUpperCase();
  if (c && isCountryCode(c)) return c;
  return 'BJ';
}

const SUB_LABEL: Record<SubChoice, string> = { CLASSIQUE: 'Classique', CIBLE: 'Ciblé', NONE: 'Aucun abonnement' };
const PACK_LABEL: Record<PackChoice, string> = { silver: 'Silver', gold: 'Gold', none: 'Pas partenaire' };
const ROLE_CHOICES = ['user', 'tester', 'withdrawal_admin', 'admin'];

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));

interface ProfileDraft {
  name: string;
  phoneNumber: string;
  country: string;
  region: string;
  momoNumber: string;
  momoOperator: string;
}

const draftOf = (u: AdminUserData): ProfileDraft => ({
  name: str(u.name),
  phoneNumber: str(u.phoneNumber),
  country: str(u.country).toUpperCase(),
  region: str(u.region),
  momoNumber: str(u.momoNumber),
  momoOperator: str(u.momoOperator),
});

/**
 * A member's editable profile (name, phone, country, region, Mobile Money)
 * and their access (pack, partner pack, role). Profile fields are saved
 * together with one button (only the changed ones are sent); pack, partner
 * pack and role each ask for confirmation and apply at once.
 */
export default function UserCard({ user, onSaved, onSubscriptionChange, onPartnerPackChange }: {
  user: AdminUserData;
  /** Called with the fields that were saved. */
  onSaved?: (changes: Partial<AdminUserData>) => void;
  onSubscriptionChange: (userId: string, newType: SubChoice) => Promise<void>;
  onPartnerPackChange: (userId: string, newPack: PackChoice) => Promise<void>;
}) {
  const canEdit = usePermission('members') === 'write';
  const [draft, setDraft] = useState<ProfileDraft>(() => draftOf(user));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(draftOf(user)); }, [user]);

  const original = useMemo(() => draftOf(user), [user]);
  const changed = (Object.keys(draft) as (keyof ProfileDraft)[]).filter(k => draft[k] !== original[k]);
  const phoneChanged = changed.includes('phoneNumber');

  const momoCountry = momoCountryOf(draft.momoNumber, draft.momoOperator || undefined, draft.region, draft.country);
  const operatorOptions = useMemo(() => {
    const ops = [...COUNTRY_OPERATORS[momoCountry]];
    if (draft.momoOperator && !ops.includes(draft.momoOperator)) ops.unshift(draft.momoOperator);
    return ops.map(o => ({ value: o, label: o }));
  }, [momoCountry, draft.momoOperator]);

  const set = (k: keyof ProfileDraft) => (v: string) => setDraft(d => ({ ...d, [k]: v }));

  const save = async () => {
    if (changed.length === 0) return;
    const payload: Record<string, string> = {};
    changed.forEach(k => { payload[k] = k === 'country' ? draft[k].toUpperCase() : draft[k]; });
    setSaving(true);
    try {
      await updateUser(user._id, payload as Partial<AdminUserData>);
      toast.success('Modifications enregistrées.');
      onSaved?.(payload as Partial<AdminUserData>);
    } catch {
      toast.error('Les modifications n’ont pas été enregistrées. Réessayez.');
    } finally {
      setSaving(false);
    }
  };

  // --- Pack, partner pack, role ---
  const initialSub: SubChoice = user.activeSubscriptionTypes?.includes(SubscriptionType.CIBLE)
    ? SubscriptionType.CIBLE
    : user.activeSubscriptionTypes?.includes(SubscriptionType.CLASSIQUE) ? SubscriptionType.CLASSIQUE : 'NONE';
  const initialPack: PackChoice = user.partnerPack === PartnerPack.SILVER ? 'silver' : user.partnerPack === PartnerPack.GOLD ? 'gold' : 'none';
  const [sub, setSub] = useState<SubChoice>(initialSub);
  const [pack, setPack] = useState<PackChoice>(initialPack);
  const [role, setRole] = useState(user.role || 'user');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<
    { kind: 'subscription'; value: SubChoice } | { kind: 'pack'; value: PackChoice } | { kind: 'role'; value: string } | null
  >(null);

  const roleLabel = (r: string) => ROLE_LABEL[r] ?? r;
  const roleOptions = (ROLE_CHOICES.includes(role) ? ROLE_CHOICES : [role, ...ROLE_CHOICES]).map(r => ({ value: r, label: roleLabel(r) }));

  const apply = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === 'subscription') {
        const before = sub;
        setSub(pending.value);
        try { await onSubscriptionChange(user._id, pending.value); } catch { setSub(before); }
      } else if (pending.kind === 'pack') {
        const before = pack;
        setPack(pending.value);
        try { await onPartnerPackChange(user._id, pending.value); } catch { setPack(before); }
      } else {
        try {
          await updateUserRole(user._id, pending.value);
          setRole(pending.value);
          toast.success(`Rôle mis à jour : ${roleLabel(pending.value)}.`);
        } catch (e) {
          toast.error(`Le rôle n’a pas été changé : ${(e as Error).message}`);
        }
      }
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const elevating = pending?.kind === 'role' && (pending.value === 'admin' || pending.value === 'withdrawal_admin');

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Panel>
        <PanelHeader title="Profil" description={canEdit ? 'Modifiez puis enregistrez : seuls les champs changés sont envoyés.' : 'Lecture seule.'} />
        <PanelBody>
          <fieldset disabled={!canEdit || saving} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nom"><Input className="h-11 sm:h-9" value={draft.name} onChange={e => set('name')(e.target.value)} /></Field>
            <Field
              label="Téléphone"
              help={phoneChanged
                ? <span className="font-medium text-[color-mix(in_oklch,var(--warning),var(--fg)_35%)]">Changer le numéro bloque les retraits du membre pendant 48 h.</span>
                : 'Avec l’indicatif du pays, sans espaces.'}
            >
              <Input className="h-11 sm:h-9" inputMode="tel" value={draft.phoneNumber} onChange={e => set('phoneNumber')(e.target.value)} />
            </Field>
            <Field label="Pays">
              <Select
                value={draft.country || undefined}
                onValueChange={set('country')}
                placeholder="Choisir un pays"
                options={draft.country && !COUNTRY_OPTIONS.some(o => o.value === draft.country)
                  ? [{ value: draft.country, label: draft.country }, ...COUNTRY_OPTIONS]
                  : COUNTRY_OPTIONS}
                className="h-11 sm:h-9"
                disabled={!canEdit || saving}
              />
            </Field>
            <Field label="Région"><Input className="h-11 sm:h-9" value={draft.region} onChange={e => set('region')(e.target.value)} /></Field>
            <Field label="Numéro Mobile Money"><Input className="h-11 sm:h-9" inputMode="tel" value={draft.momoNumber} onChange={e => set('momoNumber')(e.target.value)} /></Field>
            <Field label="Opérateur Mobile Money" help={`Opérateurs proposés : ${countryLabel(momoCountry)}.`}>
              <Select
                value={draft.momoOperator || undefined}
                onValueChange={set('momoOperator')}
                placeholder="Choisir un opérateur"
                options={operatorOptions}
                className="h-11 sm:h-9"
                disabled={!canEdit || saving}
              />
            </Field>
          </fieldset>
          <Can module="members" write>
            <div className="sticky bottom-0 -mx-5 mt-5 flex flex-col-reverse gap-2 border-t border-line bg-surface px-5 pt-4 sm:static sm:mx-0 sm:flex-row sm:items-center sm:justify-end sm:px-0">
              {changed.length > 0 && (
                <Button variant="ghost" size="lg" className="sm:h-9" onClick={() => setDraft(original)} disabled={saving}>Annuler les changements</Button>
              )}
              <Button variant="primary" size="lg" className="sm:h-9" onClick={save} loading={saving} disabled={changed.length === 0}>
                <HugeiconsIcon icon={FloppyDiskIcon} size={16} aria-hidden="true" />
                {changed.length > 1 ? `Enregistrer (${changed.length} champs)` : 'Enregistrer'}
              </Button>
            </div>
          </Can>
        </PanelBody>
      </Panel>

      <Panel className="self-start">
        <PanelHeader title="Abonnement, partenariat et rôle" description="Chaque changement est demandé en confirmation et s’applique tout de suite." />
        <PanelBody className="space-y-4">
          <Field label="Abonnement">
            <Select
              value={sub}
              onValueChange={v => setPending({ kind: 'subscription', value: v as SubChoice })}
              options={(Object.keys(SUB_LABEL) as SubChoice[]).map(v => ({ value: v, label: SUB_LABEL[v] }))}
              className="h-11 sm:h-9"
              disabled={!canEdit || busy}
            />
          </Field>
          <Can module="partners" fallback={null}>
            <Field label="Pack partenaire">
              <PartnerSelect pack={pack} busy={busy} onPick={v => setPending({ kind: 'pack', value: v })} />
            </Field>
          </Can>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-fg">Rôle</span>
            <Can module="staff" write fallback={<div><RoleBadge role={role} /></div>}>
              <Select
                value={role}
                onValueChange={v => { if (v !== role) setPending({ kind: 'role', value: v }); }}
                options={roleOptions}
                className="h-11 sm:h-9"
                disabled={busy}
              />
              {(role === 'staff' || role === 'moderator') && (
                <p className="flex items-start gap-1.5 text-xs text-fg-muted">
                  <HugeiconsIcon icon={InformationCircleIcon} size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
                  <span>Les droits par espace se règlent dans <Link to="/equipe" className="text-primary underline-offset-4 hover:underline">Équipe</Link>.</span>
                </p>
              )}
            </Can>
          </div>
        </PanelBody>
      </Panel>

      <ConfirmationModal
        isOpen={!!pending}
        variant={elevating ? 'danger' : 'primary'}
        title={pending?.kind === 'pack' ? 'Changer le pack partenaire ?' : pending?.kind === 'role' ? 'Changer le rôle ?' : 'Changer l’abonnement ?'}
        message={pending && (
          pending.kind === 'role' ? (
            <div className="space-y-2">
              <p>{user.name} passera au rôle <b className="text-fg">{roleLabel(pending.value)}</b>.</p>
              {elevating && (
                <p className="flex items-start gap-2 text-danger">
                  <HugeiconsIcon icon={Alert02Icon} size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                  Ce rôle donne un accès à l’administration.
                </p>
              )}
            </div>
          ) : (
            <p>
              {user.name} passera à <b className="text-fg">{pending.kind === 'pack' ? PACK_LABEL[pending.value] : SUB_LABEL[pending.value]}</b>.
              {' '}Cela change ses droits et ce qu’il touche sur ses filleuls.
            </p>
          )
        )}
        confirmText="Appliquer"
        onConfirm={apply}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

function PartnerSelect({ pack, busy, onPick }: { pack: PackChoice; busy: boolean; onPick: (v: PackChoice) => void }) {
  const canEditPartners = usePermission('partners') === 'write';
  return (
    <Select
      value={pack}
      onValueChange={v => onPick(v as PackChoice)}
      options={(Object.keys(PACK_LABEL) as PackChoice[]).map(v => ({ value: v, label: PACK_LABEL[v] }))}
      className="h-11 sm:h-9"
      disabled={!canEditPartners || busy}
    />
  );
}
