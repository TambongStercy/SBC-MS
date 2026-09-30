import { useEffect, useMemo, useState } from 'react';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import ConfirmationModal from '../components/common/ConfirmationModal';
import ToastContainer from '../components/common/ToastContainer';
import { useToast } from '../hooks/useToast';
import {
    getEventCommissionSettings,
    updateEventCommissionSettings,
    bustEventCommissionConfigCache,
    apiErrorMessage,
} from '../api/event';

// The API stores fractions (0.05); admins think in percent (5). Convert at the edge.
const FIELDS = [
    { key: 'primaryPct', label: 'Commission vente initiale', min: 0, max: 50, help: 'Prélevée sur chaque billet vendu par l\'organisateur. Entre 0 % et 50 %.' },
    { key: 'resalePct', label: 'Commission revente', min: 0, max: 50, help: 'Prélevée sur chaque revente entre particuliers. Entre 0 % et 50 %.' },
    { key: 'defaultMaxResalePricePct', label: 'Prix de revente maximum', min: 100, max: 300, help: 'Plafond du prix de revente, en % du prix d\'origine. Entre 100 % et 300 %.' },
] as const;

type FieldKey = typeof FIELDS[number]['key'];
type Form = Record<FieldKey, string>;

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');

export default function EventCommissionsPage() {
    const [form, setForm] = useState<Form>({ primaryPct: '', resalePct: '', defaultMaxResalePricePct: '' });
    const [saved, setSaved] = useState<Form | null>(null);
    const [examplePrice, setExamplePrice] = useState('10000');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const { toasts, removeToast, showSuccess, showError } = useToast();

    useEffect(() => {
        (async () => {
            try {
                const c = await getEventCommissionSettings();
                const next: Form = {
                    primaryPct: String(c.primaryPct * 100),
                    resalePct: String(c.resalePct * 100),
                    defaultMaxResalePricePct: String(c.defaultMaxResalePricePct),
                };
                setForm(next);
                setSaved(next);
            } catch (e: any) {
                showError(apiErrorMessage(e, 'Impossible de charger les taux de commission.'));
            } finally { setLoading(false); }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const errors = useMemo(() => {
        const out: Partial<Record<FieldKey, string>> = {};
        for (const f of FIELDS) {
            const n = Number(form[f.key]);
            if (form[f.key].trim() === '' || !Number.isFinite(n)) out[f.key] = 'Valeur requise.';
            else if (n < f.min || n > f.max) out[f.key] = `Doit être entre ${f.min} % et ${f.max} %.`;
        }
        return out;
    }, [form]);

    const dirty = saved !== null && FIELDS.some(f => form[f.key] !== saved[f.key]);
    const canSave = Object.keys(errors).length === 0 && dirty && !saving;

    // Worked example, live as the admin types.
    const example = useMemo(() => {
        const price = Math.max(0, Number(examplePrice) || 0);
        const primary = (Number(form.primaryPct) || 0) / 100;
        const resale = (Number(form.resalePct) || 0) / 100;
        const maxPct = Number(form.defaultMaxResalePricePct) || 0;
        const resalePrice = price * maxPct / 100;
        return {
            price,
            primaryFee: price * primary,
            organizerNet: price * (1 - primary),
            resalePrice,
            resaleFee: resalePrice * resale,
            sellerNet: resalePrice * (1 - resale),
        };
    }, [examplePrice, form]);

    const doSave = async () => {
        setSaving(true);
        try {
            const updated = await updateEventCommissionSettings({
                primaryPct: Number(form.primaryPct) / 100,
                resalePct: Number(form.resalePct) / 100,
                defaultMaxResalePricePct: Number(form.defaultMaxResalePricePct),
            });
            setSaved({
                primaryPct: String(updated.primaryPct * 100),
                resalePct: String(updated.resalePct * 100),
                defaultMaxResalePricePct: String(updated.defaultMaxResalePricePct),
            });
            setConfirmOpen(false);
            // event-service garde une copie en cache 60 s : on la purge tout de suite.
            try {
                await bustEventCommissionConfigCache();
                showSuccess('Taux enregistrés et appliqués immédiatement.');
            } catch {
                showSuccess('Taux enregistrés. Ils seront appliqués dans moins de 60 secondes.');
            }
        } catch (e: any) {
            showError(apiErrorMessage(e, 'Enregistrement impossible.'));
            setConfirmOpen(false);
        } finally { setSaving(false); }
    };

    return (
        <div className="flex-1 overflow-y-auto">
            <Header title="SBC Event — Commissions" />
            <div className="p-6 space-y-4 max-w-4xl">
                {loading ? <Loader name="Chargement..." /> : (
                    <>
                        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-5">
                            <p className="text-sm text-gray-500">
                                Ces taux s'appliquent à toutes les nouvelles ventes de billets. Les commandes déjà payées
                                conservent le taux en vigueur au moment de l'achat.
                            </p>

                            {FIELDS.map((f) => (
                                <div key={f.key}>
                                    <label className="block text-sm font-medium text-gray-700" htmlFor={f.key}>{f.label}</label>
                                    <div className="mt-1 flex items-center gap-2">
                                        <input
                                            id={f.key}
                                            type="number"
                                            step="0.1"
                                            min={f.min}
                                            max={f.max}
                                            value={form[f.key]}
                                            onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                                            className={`w-32 border rounded-lg px-3 py-2 text-sm ${errors[f.key] ? 'border-red-400' : 'border-gray-300'}`}
                                        />
                                        <span className="text-sm text-gray-500">%</span>
                                    </div>
                                    <div className="text-xs text-gray-400 mt-1">{f.help}</div>
                                    {errors[f.key] && <div className="text-xs text-red-600 mt-1">{errors[f.key]}</div>}
                                </div>
                            ))}

                            <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
                                <button
                                    onClick={() => setConfirmOpen(true)}
                                    disabled={!canSave}
                                    className="bg-emerald-600 text-white text-sm px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    {saving ? 'Enregistrement...' : 'Enregistrer'}
                                </button>
                                {dirty && <span className="text-xs text-amber-600">Modifications non enregistrées.</span>}
                            </div>
                        </div>

                        <div className="bg-white border border-gray-200 rounded-xl p-5">
                            <div className="flex items-center gap-2 mb-3">
                                <span className="text-sm font-medium text-gray-700">Exemple pour un billet de</span>
                                <input
                                    type="number"
                                    min={0}
                                    step={500}
                                    value={examplePrice}
                                    onChange={(e) => setExamplePrice(e.target.value)}
                                    className="w-32 border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                                />
                                <span className="text-sm text-gray-500">FCFA</span>
                            </div>
                            <div className="grid md:grid-cols-2 gap-4 text-sm">
                                <div className="bg-gray-50 rounded-lg p-4 space-y-1">
                                    <div className="font-medium text-gray-700 mb-2">Vente initiale</div>
                                    <div className="flex justify-between"><span className="text-gray-500">Prix du billet</span><span>{fmt(example.price)} FCFA</span></div>
                                    <div className="flex justify-between"><span className="text-gray-500">Commission SBC ({form.primaryPct || 0} %)</span><span className="text-red-600">−{fmt(example.primaryFee)} FCFA</span></div>
                                    <div className="flex justify-between font-semibold border-t border-gray-200 pt-1 mt-1"><span>Reversé à l'organisateur</span><span>{fmt(example.organizerNet)} FCFA</span></div>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-4 space-y-1">
                                    <div className="font-medium text-gray-700 mb-2">Revente au prix maximum</div>
                                    <div className="flex justify-between"><span className="text-gray-500">Prix de revente max ({form.defaultMaxResalePricePct || 0} %)</span><span>{fmt(example.resalePrice)} FCFA</span></div>
                                    <div className="flex justify-between"><span className="text-gray-500">Commission SBC ({form.resalePct || 0} %)</span><span className="text-red-600">−{fmt(example.resaleFee)} FCFA</span></div>
                                    <div className="flex justify-between font-semibold border-t border-gray-200 pt-1 mt-1"><span>Reversé au revendeur</span><span>{fmt(example.sellerNet)} FCFA</span></div>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>

            <ConfirmationModal
                isOpen={confirmOpen}
                title="Modifier les taux de commission"
                message={`Vente initiale ${form.primaryPct} %, revente ${form.resalePct} %, prix de revente max ${form.defaultMaxResalePricePct} %. Ces taux s'appliqueront à toutes les nouvelles ventes.`}
                confirmText="Enregistrer"
                cancelText="Annuler"
                onConfirm={doSave}
                onCancel={() => setConfirmOpen(false)}
            />
            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </div>
    );
}
