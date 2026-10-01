import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../api/apiClient';
import { useToast } from '../hooks/useToast';
import ToastContainer from '../components/common/ToastContainer';
import ConfirmationModal from '../components/common/ConfirmationModal';

type Announcement = { _id: string; title: string; body: string; url?: string; recipients: number; createdAt: string };
type Overview = { recent: Announcement[]; usedThisWeek: number; perWeek: number; audience: number };

const TITLE_MAX = 120;
const BODY_MAX = 400;

/**
 * Push announcements to every member who turned notifications on.
 * Capped server-side (a few per week): past that, people stop reading — or
 * switch "Annonces SBC" off, and then nothing reaches them.
 */
const PushAnnouncementsPage: React.FC = () => {
    const { toasts, removeToast, showSuccess, showError } = useToast();
    const [overview, setOverview] = useState<Overview | null>(null);
    const [loading, setLoading] = useState(true);
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [url, setUrl] = useState('');
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [sending, setSending] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await apiClient.get('/notifications/push/admin/announcements');
            setOverview(data.data);
        } catch {
            showError('Could not load announcements.');
        } finally {
            setLoading(false);
        }
    }, [showError]);

    useEffect(() => { load(); }, [load]);

    const linkValid = url === '' || url.startsWith('/');
    const capReached = !!overview && overview.usedThisWeek >= overview.perWeek;
    const canSend = title.trim() && body.trim() && linkValid && !capReached && !sending;

    const send = async () => {
        setSending(true);
        try {
            const { data } = await apiClient.post('/notifications/push/admin/announce', {
                title: title.trim(), body: body.trim(), ...(url ? { url } : {}),
            });
            showSuccess(`Sending to ${data.data.recipients} member(s).`);
            setTitle(''); setBody(''); setUrl('');
            load();
        } catch (err) {
            const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
            showError(message || 'The announcement could not be sent.');
        } finally {
            setSending(false);
            setConfirmOpen(false);
        }
    };

    return (
        <div className="flex-1 overflow-auto relative z-10 bg-gray-900 text-white p-4 md:p-8">
            <ToastContainer toasts={toasts} onRemove={removeToast} />
            <h1 className="text-2xl md:text-3xl font-bold mb-6">Push Announcements</h1>

            <div className="max-w-3xl mx-auto grid grid-cols-2 gap-4 mb-6">
                <div className="bg-gray-800 rounded-lg p-4">
                    <div className="text-sm text-gray-400">Members with notifications on</div>
                    <div className="text-2xl font-bold">{loading ? '…' : overview?.audience ?? 0}</div>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                    <div className="text-sm text-gray-400">Sent in the last 7 days</div>
                    <div className={`text-2xl font-bold ${capReached ? 'text-red-400' : ''}`}>
                        {loading ? '…' : `${overview?.usedThisWeek ?? 0} / ${overview?.perWeek ?? 3}`}
                    </div>
                </div>
            </div>

            <div className="max-w-3xl mx-auto bg-gray-800 rounded-lg p-6 space-y-4">
                <label className="block">
                    <span className="text-sm text-gray-300">Title</span>
                    <input
                        value={title}
                        maxLength={TITLE_MAX}
                        onChange={e => setTitle(e.target.value)}
                        placeholder="Nouvelle formation disponible"
                        className="mt-1 w-full bg-gray-700 rounded-md px-3 py-2 text-white"
                    />
                </label>
                <label className="block">
                    <span className="text-sm text-gray-300">Message ({body.length}/{BODY_MAX})</span>
                    <textarea
                        value={body}
                        maxLength={BODY_MAX}
                        rows={3}
                        onChange={e => setBody(e.target.value)}
                        placeholder="Découvre la formation « Vendre sur WhatsApp » dès maintenant."
                        className="mt-1 w-full bg-gray-700 rounded-md px-3 py-2 text-white"
                    />
                </label>
                <label className="block">
                    <span className="text-sm text-gray-300">Opens (app page, optional)</span>
                    <input
                        value={url}
                        onChange={e => setUrl(e.target.value.trim())}
                        placeholder="/formations"
                        className={`mt-1 w-full bg-gray-700 rounded-md px-3 py-2 text-white ${linkValid ? '' : 'ring-2 ring-red-500'}`}
                    />
                    {!linkValid && <span className="text-xs text-red-400">Must be an app page starting with « / ».</span>}
                </label>

                {(title || body) && (
                    <div>
                        <div className="text-sm text-gray-400 mb-1">Preview</div>
                        <div className="bg-gray-950 rounded-xl p-3 flex gap-3 items-start">
                            <span className="w-10 h-10 rounded-full bg-blue-600 grid place-items-center text-xs font-bold shrink-0">SBC</span>
                            <div className="min-w-0">
                                <div className="font-semibold truncate">{title || 'Title'}</div>
                                <div className="text-sm text-gray-300 line-clamp-3">{body || 'Message'}</div>
                            </div>
                        </div>
                    </div>
                )}

                <button
                    onClick={() => setConfirmOpen(true)}
                    disabled={!canSend}
                    className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-40 rounded-md py-2 font-semibold"
                >
                    {capReached ? 'Weekly limit reached' : 'Send to everyone'}
                </button>
                <p className="text-xs text-gray-400">
                    Members who switched off « Annonces SBC » don't receive it. Sent at night, it waits until 07:00 (Douala).
                </p>
            </div>

            <div className="max-w-3xl mx-auto mt-6">
                <h2 className="text-lg font-semibold mb-3">Recent</h2>
                {overview?.recent.length ? (
                    <ul className="space-y-2">
                        {overview.recent.map(a => (
                            <li key={a._id} className="bg-gray-800 rounded-lg p-3">
                                <div className="flex justify-between gap-3">
                                    <span className="font-medium">{a.title}</span>
                                    <span className="text-xs text-gray-400 shrink-0">{new Date(a.createdAt).toLocaleString()}</span>
                                </div>
                                <div className="text-sm text-gray-300">{a.body}</div>
                                <div className="text-xs text-gray-400 mt-1">{a.recipients} member(s){a.url ? ` · ${a.url}` : ''}</div>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-gray-400">{loading ? 'Loading…' : 'No announcement yet.'}</p>
                )}
            </div>

            <ConfirmationModal
                isOpen={confirmOpen}
                title="Send this announcement?"
                message={`It goes to ${overview?.audience ?? 0} member(s) and uses 1 of ${overview?.perWeek ?? 3} weekly announcements. It cannot be recalled.`}
                confirmText="Send"
                cancelText="Cancel"
                isLoading={sending}
                onConfirm={send}
                onCancel={() => setConfirmOpen(false)}
            />
        </div>
    );
};

export default PushAnnouncementsPage;
