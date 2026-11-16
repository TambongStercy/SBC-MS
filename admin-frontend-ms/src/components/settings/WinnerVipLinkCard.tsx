import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import axios from 'axios';
import { updateSettings, ISettings } from '../../services/adminSettingsApi';

/**
 * Pack Winner VIP WhatsApp group (Rufus, 2026-11-15). Winner members see a
 * « Rejoindre le groupe VIP » button on their pack card and their profile as
 * soon as this link is set; clearing it hides the button.
 */
const WinnerVipLinkCard: React.FC<{ value?: string; onSaved: (settings: ISettings) => void }> = ({ value, onSaved }) => {
    const [link, setLink] = useState(value ?? '');
    const [saving, setSaving] = useState(false);

    useEffect(() => { setLink(value ?? ''); }, [value]);

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            const updated = await updateSettings({ winnerVipGroupUrl: link.trim() });
            onSaved(updated);
            toast.success(link.trim() ? 'Lien du groupe VIP enregistré.' : 'Lien du groupe VIP retiré.');
        } catch (error) {
            const message = axios.isAxiosError(error) && error.response?.data?.message;
            toast.error(message || "Le lien n'a pas pu être enregistré.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={save} className="bg-gray-800 shadow-sm rounded-lg p-6 space-y-3 mb-8">
            <div>
                <h3 className="text-lg font-semibold text-white">Pack Winner : groupe WhatsApp VIP</h3>
                <p className="text-sm text-gray-400">
                    Les abonnés Winner voient le bouton « Rejoindre le groupe VIP » sur leur pack et dans leur profil dès que ce lien est enregistré. Videz le champ pour retirer le bouton.
                </p>
            </div>
            <label htmlFor="winnerVipGroupUrl" className="block text-sm font-medium text-gray-300">Lien d'invitation du groupe</label>
            <input
                id="winnerVipGroupUrl"
                type="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://chat.whatsapp.com/…"
                className="w-full rounded-md border border-gray-600 bg-gray-700 px-3 py-2 text-white placeholder-gray-400 focus:border-indigo-500 focus:outline-hidden"
            />
            <button
                type="submit"
                disabled={saving || link.trim() === (value ?? '')}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
                {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
        </form>
    );
};

export default WinnerVipLinkCard;
