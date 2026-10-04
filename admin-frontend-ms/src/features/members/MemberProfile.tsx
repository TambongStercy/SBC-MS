import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { updateMember, type Member } from './api';
import { Button, Card, ConfirmSheet, Input, KeyValue, SectionTitle, Select, notify } from '../../ui';
import { countryCodeToNameMap } from '../../utils/countryUtils';
import { OPERATORS_BY_COUNTRY, OPERATOR_NAME, countryOfOperator } from '../../lib/operators';
import { formatPhone } from '../../lib/format';
import { errorMessage } from '../../lib/hooks';

const COUNTRIES = Object.entries(countryCodeToNameMap).filter(([c]) => /^[A-Z]{2}$/.test(c)).sort((a, b) => a[1].localeCompare(b[1], 'fr'));

/**
 * Contact details and the payout number. Changing where a member's
 * withdrawals go is the edit that matters: it asks first.
 */
export function MemberProfile({ member }: { member: Member }) {
    const qc = useQueryClient();
    const initial = useMemo(() => ({
        name: member.name ?? '', email: member.email ?? '', phoneNumber: String(member.phoneNumber ?? ''),
        country: (member.country ?? '').toUpperCase(), region: member.region ?? '', city: member.city ?? '',
        momoNumber: String(member.momoNumber ?? ''), momoOperator: member.momoOperator ?? '',
    }), [member]);
    const [form, setForm] = useState(initial);
    const [momoCountry, setMomoCountry] = useState(countryOfOperator(member.momoOperator) ?? (member.country ?? '').toUpperCase());
    const [saving, setSaving] = useState(false);
    const [confirmMomo, setConfirmMomo] = useState(false);
    useEffect(() => { setForm(initial); }, [initial]);

    const changed = (Object.keys(form) as Array<keyof typeof form>).filter(k => form[k] !== initial[k]);
    const momoChanged = changed.includes('momoNumber') || changed.includes('momoOperator');
    const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

    const save = async () => {
        const body: Record<string, string> = {};
        changed.forEach(k => { body[k] = form[k].trim(); });
        setSaving(true);
        try {
            await updateMember(member._id, body);
            notify.success('Profil enregistré.');
            qc.invalidateQueries({ queryKey: ['member', member._id] });
        } catch (e) {
            notify.error(errorMessage(e, "Le profil n'a pas été enregistré."));
            throw e;
        } finally {
            setSaving(false);
        }
    };

    const operators = OPERATORS_BY_COUNTRY[momoCountry] ?? [];

    return (
        <div className="space-y-4">
            <Card className="space-y-4">
                <SectionTitle>Coordonnées</SectionTitle>
                <Input label="Nom" value={form.name} onChange={set('name')} />
                <div className="grid sm:grid-cols-2 gap-4">
                    <Input label="Téléphone (avec indicatif)" inputMode="tel" value={form.phoneNumber} onChange={set('phoneNumber')} hint={formatPhone(form.phoneNumber)} />
                    <Input label="Email" type="email" value={form.email} onChange={set('email')} />
                </div>
                <div className="grid sm:grid-cols-3 gap-4">
                    <Select label="Pays" value={form.country} onChange={set('country')}>
                        <option value="">—</option>{COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                    </Select>
                    <Input label="Région" value={form.region} onChange={set('region')} />
                    <Input label="Ville" value={form.city} onChange={set('city')} />
                </div>
            </Card>
            <Card className="space-y-4">
                <SectionTitle>Numéro de retrait</SectionTitle>
                <div className="grid sm:grid-cols-3 gap-4">
                    <Select label="Pays du numéro" value={momoCountry} onChange={e => { setMomoCountry(e.target.value); setForm(f => ({ ...f, momoOperator: '' })); }}>
                        <option value="">—</option>{Object.keys(OPERATORS_BY_COUNTRY).map(c => <option key={c} value={c}>{countryCodeToNameMap[c] ?? c}</option>)}
                    </Select>
                    <Select label="Opérateur" value={form.momoOperator} onChange={set('momoOperator')} disabled={!operators.length}>
                        <option value="">—</option>{operators.map(o => <option key={o} value={o}>{OPERATOR_NAME[o] ?? o}</option>)}
                    </Select>
                    <Input label="Numéro" inputMode="tel" value={form.momoNumber} onChange={set('momoNumber')} hint={form.momoNumber ? formatPhone(form.momoNumber) : 'Avec l’indicatif du pays'} />
                </div>
            </Card>
            <div className="flex justify-end gap-2">
                <Button variant="secondary" disabled={!changed.length || saving} onClick={() => setForm(initial)}>Annuler</Button>
                <Button disabled={!changed.length} loading={saving} onClick={() => (momoChanged ? setConfirmMomo(true) : save().catch(() => {}))}>Enregistrer</Button>
            </div>
            <ConfirmSheet open={confirmMomo} onClose={() => setConfirmMomo(false)} title="Changer le numéro de retrait ?"
                message={<>
                    <p>Les prochains retraits de {member.name} iront vers :</p>
                    <KeyValue items={[['Numéro', formatPhone(form.momoNumber) || '—'], ['Opérateur', OPERATOR_NAME[form.momoOperator] ?? (form.momoOperator || '—')]]} />
                    <p>Fais-le seulement à la demande du membre, après avoir vérifié que c’est bien lui.</p>
                </>}
                confirmLabel="Changer le numéro" onConfirm={save} />
        </div>
    );
}
