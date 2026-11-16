import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon } from '@hugeicons/core-free-icons';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import ConfirmationModal from '../components/common/ConfirmationModal';
import ToastContainer from '../components/common/ToastContainer';
import { useToast } from '../hooks/useToast';
import {
    AdminEvent, EventStatus, listAdminEvents, suspendAdminEvent, cancelAdminEvent, approveAdminEvent, rejectAdminEvent, apiErrorMessage,
} from '../api/event';

const STATUS_STYLES: Record<EventStatus, string> = {
    DRAFT: 'bg-gray-100 text-gray-700',
    PENDING_REVIEW: 'bg-amber-100 text-amber-800',
    REJECTED: 'bg-red-100 text-red-700',
    PUBLISHED: 'bg-emerald-100 text-emerald-700',
    SUSPENDED: 'bg-amber-100 text-amber-800',
    CANCELLED: 'bg-red-100 text-red-700',
    COMPLETED: 'bg-blue-100 text-blue-700',
};

const STATUS_LABELS: Record<EventStatus, string> = {
    DRAFT: 'Brouillon',
    PENDING_REVIEW: 'À valider',
    REJECTED: 'Refusé',
    PUBLISHED: 'En vente',
    SUSPENDED: 'Suspendu',
    CANCELLED: 'Annulé',
    COMPLETED: 'Passé',
};

const STATUS_FILTERS: { value: EventStatus; label: string }[] = [
    { value: 'PENDING_REVIEW', label: 'À valider' },
    { value: 'REJECTED', label: 'Refusés' },
    { value: 'DRAFT', label: 'Brouillons' },
    { value: 'PUBLISHED', label: 'Publiés' },
    { value: 'SUSPENDED', label: 'Suspendus' },
    { value: 'CANCELLED', label: 'Annulés' },
    { value: 'COMPLETED', label: 'Terminés' },
];

const REJECT_SUGGESTIONS = ['Informations incomplètes', 'Affiche ou description inappropriée', 'Date ou lieu incohérent', 'Lien WhatsApp manquant ou invalide'];
const REJECT_MIN = 5;

const fmt = (iso?: string) => iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const isWebinaire = (e: AdminEvent) => e.category === 'webinaire';
/** Where an event takes place: a venue, or the WhatsApp link of a webinaire. */
const eventPlace = (e: AdminEvent) => isWebinaire(e) ? 'Webinaire WhatsApp' : [e.venue, e.city].filter(Boolean).join(' · ');
const isStatus = (v: string | null): v is EventStatus => !!v && v in STATUS_LABELS;

type Confirm = { title: string; message: ReactNode; confirmText: string; variant: 'danger' | 'success' | 'primary'; onConfirm: () => Promise<void> };

/**
 * Every event. An event the organizer sends for review waits in « À valider »:
 * SBC accepts it (published, tickets on sale) or refuses it with a reason the
 * organizer sees; the organizer can then edit it and send it again. Refusing
 * never blocks the organizer's other events. Opens on « À valider » when events
 * wait for SBC's decision (`?status=` picks another filter).
 */
export default function EventListPage() {
    const [searchParams] = useSearchParams();
    const initial = searchParams.get('status');
    const [items, setItems] = useState<AdminEvent[]>([]);
    const [total, setTotal] = useState(0);
    // null until we know whether events wait for review (then default to « À valider »)
    const [status, setStatus] = useState<EventStatus | '' | null>(isStatus(initial) ? initial : initial === 'all' ? '' : null);
    const [waiting, setWaiting] = useState<number | null>(null);
    const [q, setQ] = useState('');
    const [loading, setLoading] = useState(true);
    const [confirm, setConfirm] = useState<Confirm | null>(null);
    const [rejecting, setRejecting] = useState<AdminEvent | null>(null);
    const [detail, setDetail] = useState<AdminEvent | null>(null);
    const { toasts, removeToast, showSuccess, showError } = useToast();

    const loadWaiting = useCallback(async () => {
        try {
            const { total } = await listAdminEvents({ status: 'PENDING_REVIEW', limit: 1 });
            setWaiting(total);
            return total;
        } catch { setWaiting(null); return 0; }
    }, []);

    useEffect(() => {
        loadWaiting().then(n => setStatus(s => (s === null ? (n ? 'PENDING_REVIEW' : '') : s)));
    }, [loadWaiting]);

    const load = useCallback(async () => {
        if (status === null) return;
        setLoading(true);
        try {
            const { items, total } = await listAdminEvents({ status: status || undefined, q: q.trim() || undefined, limit: 100 });
            setItems(items);
            setTotal(total);
        } catch (e: unknown) { showError(apiErrorMessage(e, 'Erreur.')); }
        finally { setLoading(false); }
    }, [status, q, showError]);

    // debounced so typing in the search box doesn't fire a request per keystroke
    useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);

    const reloadAll = () => { load(); loadWaiting(); };

    const run = (fn: () => Promise<unknown>, ok: string) => async () => {
        try { await fn(); showSuccess(ok); setConfirm(null); setDetail(null); reloadAll(); }
        catch (e: unknown) { showError(apiErrorMessage(e, 'Erreur.')); setConfirm(null); }
    };

    const doApprove = (ev: AdminEvent) => setConfirm({
        title: `Accepter « ${ev.title} » ?`,
        message: 'L’événement est publié et ses billets mis en vente. L’organisateur est prévenu.',
        confirmText: 'Accepter et publier',
        variant: 'success',
        onConfirm: run(() => approveAdminEvent(ev._id), 'Événement accepté et publié.'),
    });

    const doSuspend = (ev: AdminEvent) => setConfirm({
        title: 'Suspendre l\'événement',
        message: `« ${ev.title} » n'est plus en vente ni visible dans les listes publiques. Les billets déjà vendus restent valables.`,
        confirmText: 'Suspendre',
        variant: 'danger',
        onConfirm: run(() => suspendAdminEvent(ev._id), 'Événement suspendu.'),
    });

    const doCancel = (ev: AdminEvent) => setConfirm({
        title: 'Annuler l\'événement',
        message: `« ${ev.title} » sera annulé. Chaque commande payée est remboursée automatiquement sur le solde SBC de l'acheteur, les billets sont annulés, les reventes retirées et les acheteurs prévenus.`,
        confirmText: 'Annuler l\'événement',
        variant: 'danger',
        onConfirm: run(() => cancelAdminEvent(ev._id, 'Annulation administrateur'), 'Événement annulé.'),
    });

    const actions = (ev: AdminEvent, small = true) => {
        const cls = small ? 'text-xs px-2 py-1 rounded-sm' : 'text-sm px-3 py-2 rounded-lg';
        return (
            <>
                {ev.status === 'PENDING_REVIEW' && <>
                    <button onClick={() => doApprove(ev)} className={`${cls} bg-emerald-600 text-white`}>Accepter</button>
                    <button onClick={() => setRejecting(ev)} className={`${cls} bg-red-600 text-white`}>Refuser</button>
                </>}
                {ev.status === 'PUBLISHED' && <button onClick={() => doSuspend(ev)} className={`${cls} bg-amber-600 text-white`}>Suspendre</button>}
                {ev.status !== 'CANCELLED' && ev.status !== 'COMPLETED' && ev.status !== 'PENDING_REVIEW' && ev.status !== 'REJECTED'
                    && <button onClick={() => doCancel(ev)} className={`${cls} bg-red-600 text-white`}>Annuler</button>}
            </>
        );
    };

    return (
        <div className="flex-1 overflow-y-auto">
            <Header title="SBC Event — Événements" />
            <div className="space-y-4">
                {!!waiting && status !== 'PENDING_REVIEW' && (
                    <button onClick={() => setStatus('PENDING_REVIEW')} className="w-full text-left rounded-xl border border-amber-600 bg-amber-100 dark:bg-amber-900/30 p-3 text-sm text-amber-800 dark:text-amber-100 hover:bg-amber-100 dark:hover:bg-amber-900/50">
                        <b>{waiting} événement{waiting > 1 ? 's' : ''} à valider.</b> SBC accepte ou refuse chaque événement envoyé par un organisateur avant sa mise en vente.
                        <span className="ml-2 font-semibold text-blue-600 dark:text-blue-300">Voir</span>
                    </button>
                )}
                <div className="flex items-center gap-3 flex-wrap">
                    <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Rechercher un titre ou une ville"
                        className="border border-line-strong rounded-lg px-3 py-2 text-sm w-72 bg-surface text-fg"
                    />
                    <select value={status ?? ''} onChange={(e) => setStatus(e.target.value as EventStatus | '')} className="border border-line-strong rounded-lg px-3 py-2 text-sm bg-surface text-fg hover:bg-surface-2">
                        <option value="">Tous les statuts</option>
                        {STATUS_FILTERS.map(f => (
                            <option key={f.value} value={f.value}>{f.label}{f.value === 'PENDING_REVIEW' && waiting ? ` (${waiting})` : ''}</option>
                        ))}
                    </select>
                    <button onClick={reloadAll} className="border border-line-strong rounded-lg px-3 py-2 text-sm bg-surface text-fg hover:bg-surface-2">Actualiser</button>
                    {!loading && <span className="text-sm text-fg-muted">{total} événement{total > 1 ? 's' : ''}{total > items.length ? ` (${items.length} affichés)` : ''}</span>}
                </div>

                {loading || status === null ? <Loader name="Chargement..." /> : (
                    <div className="overflow-x-auto bg-surface rounded-xl border border-line">
                        <table className="min-w-full text-sm">
                            <thead className="bg-background/50 text-fg-muted">
                                <tr>
                                    <th className="px-4 py-2 text-left">Titre</th>
                                    <th className="px-4 py-2 text-left">Statut</th>
                                    <th className="px-4 py-2 text-left">Date</th>
                                    <th className="px-4 py-2 text-left">Lieu</th>
                                    <th className="px-4 py-2 text-left">Ventes</th>
                                    <th className="px-4 py-2 text-left">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.length === 0 && (
                                    <tr><td colSpan={6} className="px-4 py-6 text-center text-fg-muted">{status === 'PENDING_REVIEW' ? 'Aucun événement à valider.' : 'Aucun événement.'}</td></tr>
                                )}
                                {items.map((ev) => (
                                    <tr key={ev._id} className="border-t border-line">
                                        <td className="px-4 py-2">
                                            <button onClick={() => setDetail(ev)} className="text-left hover:underline">
                                                <div className="font-medium">{ev.title}</div>
                                            </button>
                                            <div className="text-xs text-fg-muted">{ev.slug}</div>
                                        </td>
                                        <td className="px-4 py-2">
                                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[ev.status] ?? 'bg-gray-100 text-gray-700'}`}>{STATUS_LABELS[ev.status] ?? ev.status}</span>
                                            {ev.status === 'PENDING_REVIEW' && ev.submittedAt && <div className="text-xs text-fg-muted mt-1">envoyé le {fmt(ev.submittedAt)}</div>}
                                            {ev.status === 'REJECTED' && ev.rejectionReason && <div className="text-xs text-red-600 dark:text-red-300 mt-1 max-w-xs truncate" title={ev.rejectionReason}>{ev.rejectionReason}</div>}
                                        </td>
                                        <td className="px-4 py-2 text-xs">{fmt(ev.startsAt)}</td>
                                        <td className="px-4 py-2 text-xs">
                                            {isWebinaire(ev) && <span className="px-2 py-0.5 mr-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700">Webinaire</span>}
                                            {eventPlace(ev)}
                                        </td>
                                        <td className="px-4 py-2 text-xs">
                                            {ev.totals?.ticketsSold ?? 0} billets · {(ev.totals?.grossRevenue ?? 0).toLocaleString('fr-FR')} XAF
                                        </td>
                                        <td className="px-4 py-2 space-x-2 whitespace-nowrap">
                                            <button onClick={() => setDetail(ev)} className="text-xs bg-surface-3 text-fg px-2 py-1 rounded-sm">Détails</button>
                                            {actions(ev)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {detail && (
                <div className="fixed inset-0 bg-black/70 z-40 flex justify-center items-center p-4" onClick={() => setDetail(null)}>
                    <div className="bg-surface border border-line rounded-xl w-full max-w-lg max-h-full overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="px-5 py-4 border-b border-line flex items-start justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-semibold text-fg">{detail.title}</h2>
                                <span className={`inline-block mt-1 px-2 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[detail.status]}`}>{STATUS_LABELS[detail.status] ?? detail.status}</span>
                            </div>
                            <button onClick={() => setDetail(null)} className="text-fg-muted hover:text-fg p-1" aria-label="Fermer"><HugeiconsIcon icon={Cancel01Icon} size={20} /></button>
                        </div>
                        <dl className="px-5 py-4 space-y-2 text-sm">
                            {([
                                ['Lieu', eventPlace(detail) || '—'],
                                isWebinaire(detail) && ['Lien WhatsApp', detail.accessLink
                                    ? <a href={detail.accessLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-300 underline break-all">{detail.accessLink}</a>
                                    : <span className="text-red-600 dark:text-red-400">Pas encore renseigné</span>],
                                ['Début', fmt(detail.startsAt)],
                                ['Fin', fmt(detail.endsAt)],
                                !!detail.submittedAt && ['Envoyé pour validation', fmt(detail.submittedAt)],
                                !!detail.reviewedAt && [detail.status === 'REJECTED' ? 'Refusé le' : 'Validé le', fmt(detail.reviewedAt)],
                                detail.status === 'REJECTED' && !!detail.rejectionReason && ['Motif du refus', detail.rejectionReason],
                                ['Ventes', `${detail.totals?.ticketsSold ?? 0} billets · ${(detail.totals?.grossRevenue ?? 0).toLocaleString('fr-FR')} XAF`],
                                ['Créé le', fmt(detail.createdAt)],
                            ].filter(Boolean) as [string, ReactNode][]).map(([k, v]) => (
                                <div key={k} className="flex gap-3"><dt className="w-44 shrink-0 text-fg-muted">{k}</dt><dd className="text-fg min-w-0 wrap-break-word">{v}</dd></div>
                            ))}
                        </dl>
                        <div className="px-5 py-3 border-t border-line flex flex-wrap justify-end gap-2">{actions(detail, false)}</div>
                    </div>
                </div>
            )}

            {confirm && (
                <ConfirmationModal
                    isOpen
                    title={confirm.title}
                    message={confirm.message}
                    confirmText={confirm.confirmText}
                    cancelText="Retour"
                    variant={confirm.variant}
                    onConfirm={confirm.onConfirm}
                    onCancel={() => setConfirm(null)}
                />
            )}
            {rejecting && (
                <RejectModal
                    event={rejecting}
                    onCancel={() => setRejecting(null)}
                    onConfirm={async (reason) => {
                        try {
                            await rejectAdminEvent(rejecting._id, reason);
                            showSuccess('Événement refusé : l’organisateur est prévenu.');
                            setRejecting(null); setDetail(null); reloadAll();
                        } catch (e: unknown) { showError(apiErrorMessage(e, 'Erreur.')); }
                    }}
                />
            )}
            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </div>
    );
}

/** Refusing needs a reason: it is sent to the organizer, who can edit the event and send it again. */
function RejectModal({ event, onCancel, onConfirm }: { event: AdminEvent; onCancel: () => void; onConfirm: (reason: string) => Promise<void> }) {
    const [reason, setReason] = useState('');
    const [touched, setTouched] = useState(false);
    const invalid = reason.trim().length < REJECT_MIN;
    return (
        <ConfirmationModal
            isOpen
            title={`Refuser « ${event.title} » ?`}
            message="Il n’est pas publié. L’organisateur reçoit le motif et peut modifier son événement puis l’envoyer à nouveau. Son compte et ses autres événements ne sont pas touchés."
            confirmText="Refuser"
            cancelText="Retour"
            variant="danger"
            onCancel={onCancel}
            onConfirm={() => { setTouched(true); if (!invalid) return onConfirm(reason.trim()); }}
        >
            <div className="mb-5 space-y-2">
                <label className="block text-sm text-fg-muted">Motif (envoyé à l’organisateur)</label>
                <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={1000}
                    className="w-full border border-line-strong rounded-lg px-3 py-2 text-sm bg-surface text-fg" />
                <div className="flex flex-wrap gap-1.5">
                    {REJECT_SUGGESTIONS.map(s => (
                        <button key={s} type="button" onClick={() => setReason(s)} className="text-xs px-2 py-1 rounded-full bg-surface-2 text-fg hover:bg-surface-3">{s}</button>
                    ))}
                </div>
                {touched && invalid && <p className="text-xs text-red-600 dark:text-red-400">Au moins {REJECT_MIN} caractères.</p>}
            </div>
        </ConfirmationModal>
    );
}
