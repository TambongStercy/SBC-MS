import React, { useState, useEffect } from 'react';
import { MessageSquare, Edit2, Eye, Save, X, ToggleLeft, ToggleRight, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { HugeiconsIcon } from '@hugeicons/react';
import { Robot01Icon, PencilEdit01Icon } from '@hugeicons/core-free-icons';
import { getSmsTemplates, updateSmsTemplate, previewSmsTemplate, SmsTemplate } from '../services/adminRelanceApi';

const RelanceSmsTemplatesPage: React.FC = () => {
    const [templates, setTemplates] = useState<SmsTemplate[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'auto' | 'manual'>('auto');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editText, setEditText] = useState('');
    const [saving, setSaving] = useState(false);
    const [previewData, setPreviewData] = useState<{ rendered: string; characterCount: number } | null>(null);
    const [previewLink, setPreviewLink] = useState('https://example.com/mon-lien');
    const [previewTarget, setPreviewTarget] = useState<SmsTemplate | null>(null);

    useEffect(() => {
        loadTemplates();
    }, []);

    const loadTemplates = async () => {
        try {
            setLoading(true);
            const data = await getSmsTemplates();
            setTemplates(data);
        } catch {
            toast.error('Erreur lors du chargement des modèles SMS');
        } finally {
            setLoading(false);
        }
    };

    const filtered = templates.filter(t => t.type === activeTab).sort((a, b) => a.dayNumber - b.dayNumber);

    const startEdit = (tpl: SmsTemplate) => {
        setEditingId(tpl._id);
        setEditText(tpl.templateText);
        setPreviewData(null);
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditText('');
        setPreviewData(null);
    };

    const saveEdit = async (tpl: SmsTemplate) => {
        if (!editText.trim()) { toast.error('Le texte ne peut pas être vide'); return; }
        setSaving(true);
        try {
            const updated = await updateSmsTemplate(tpl.type, tpl.dayNumber, { templateText: editText });
            setTemplates(prev => prev.map(t => t._id === updated._id ? updated : t));
            setEditingId(null);
            toast.success('Modèle mis à jour');
        } catch {
            toast.error('Erreur lors de la sauvegarde');
        } finally {
            setSaving(false);
        }
    };

    const toggleActive = async (tpl: SmsTemplate) => {
        try {
            const updated = await updateSmsTemplate(tpl.type, tpl.dayNumber, { active: !tpl.active });
            setTemplates(prev => prev.map(t => t._id === updated._id ? updated : t));
            toast.success(updated.active ? 'Modèle activé' : 'Modèle désactivé');
        } catch {
            toast.error('Erreur lors de la mise à jour');
        }
    };

    const handlePreview = async (tpl: SmsTemplate) => {
        try {
            setPreviewTarget(tpl);
            const data = await previewSmsTemplate(tpl.type, tpl.dayNumber, previewLink);
            setPreviewData(data);
        } catch {
            toast.error('Erreur lors de la prévisualisation');
        }
    };

    const dayLabel = (type: 'auto' | 'manual', day: number) =>
        type === 'auto' ? (day === 0 ? 'J0 (15 min)' : `J${day}`) : `Jour ${day}`;

    const charCount = (text: string) => text.replace(/\{\{link\}\}/g, previewLink).length;

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
        );
    }

    return (
        <div>
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-fg flex items-center gap-2">
                    <MessageSquare className="w-7 h-7 text-blue-600 dark:text-blue-400" />
                    Modèles SMS de relance
                </h1>
                <p className="text-fg-muted mt-1 text-sm">
                    Messages prédéfinis — les utilisateurs ajoutent uniquement leur lien via <code className="bg-surface-2 px-1 rounded-sm">{'{{link}}'}</code>
                </p>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 mb-6">
                {(['auto', 'manual'] as const).map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                            activeTab === tab
                                ? 'bg-blue-600 text-white'
                                : 'bg-surface-2 text-fg-muted hover:bg-surface-3'
                        }`}
                    >
                        <HugeiconsIcon icon={tab === 'auto' ? Robot01Icon : PencilEdit01Icon} size={16} />
                        {tab === 'auto' ? 'Automatique (J0–J7)' : 'Manuel (Jour 1–7)'}
                    </button>
                ))}
            </div>

            {/* Preview link input */}
            <div className="bg-surface border border-line rounded-lg p-4 mb-4 flex items-center gap-3">
                <Eye className="w-4 h-4 text-fg-muted shrink-0" />
                <span className="text-fg-muted text-sm">Lien pour prévisualisation :</span>
                <input
                    value={previewLink}
                    onChange={e => setPreviewLink(e.target.value)}
                    className="flex-1 bg-surface text-fg text-sm rounded-sm px-3 py-1.5 border border-line-strong focus:outline-hidden focus:border-blue-500"
                    placeholder="https://..."
                />
            </div>

            {/* Template list */}
            <div className="space-y-4">
                {filtered.map(tpl => (
                    <div key={tpl._id} className={`bg-surface rounded-xl border ${tpl.active ? 'border-line' : 'border-line opacity-60'}`}>
                        <div className="flex items-center justify-between p-4 pb-2">
                            <div className="flex items-center gap-3">
                                <span className="bg-blue-600/20 text-blue-700 dark:text-blue-400 text-xs font-bold px-2 py-1 rounded-sm">
                                    {dayLabel(tpl.type, tpl.dayNumber)}
                                </span>
                                {!tpl.active && (
                                    <span className="text-xs text-fg-subtle bg-surface-2 px-2 py-0.5 rounded-sm">Inactif</span>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => handlePreview(tpl)}
                                    className="p-1.5 rounded-sm text-fg-muted hover:text-blue-700 dark:hover:text-blue-400 hover:bg-surface-2"
                                    title="Prévisualiser"
                                >
                                    <Eye className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => toggleActive(tpl)}
                                    className="p-1.5 rounded-sm text-fg-muted hover:text-yellow-800 dark:hover:text-yellow-400 hover:bg-surface-2"
                                    title={tpl.active ? 'Désactiver' : 'Activer'}
                                >
                                    {tpl.active
                                        ? <ToggleRight className="w-5 h-5 text-green-600 dark:text-green-400" />
                                        : <ToggleLeft className="w-5 h-5 text-fg-subtle" />}
                                </button>
                                {editingId !== tpl._id && (
                                    <button
                                        onClick={() => startEdit(tpl)}
                                        className="p-1.5 rounded-sm text-fg-muted hover:text-fg hover:bg-surface-2"
                                        title="Modifier"
                                    >
                                        <Edit2 className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="px-4 pb-4">
                            {editingId === tpl._id ? (
                                <div className="space-y-2">
                                    <textarea
                                        value={editText}
                                        onChange={e => setEditText(e.target.value)}
                                        rows={5}
                                        className="w-full bg-surface text-fg text-sm rounded-lg p-3 border border-blue-500 focus:outline-hidden resize-none font-mono"
                                    />
                                    <div className="flex items-center justify-between">
                                        <span className={`text-xs ${charCount(editText) > 160 ? 'text-orange-600 dark:text-orange-400' : 'text-fg-muted'}`}>
                                            {charCount(editText)} caractères ({Math.ceil(charCount(editText) / 160)} SMS)
                                        </span>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={cancelEdit}
                                                className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-surface-2 text-fg-muted hover:bg-surface-3"
                                            >
                                                <X className="w-3.5 h-3.5" /> Annuler
                                            </button>
                                            <button
                                                onClick={() => saveEdit(tpl)}
                                                disabled={saving}
                                                className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                                            >
                                                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                                Enregistrer
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <pre className="text-fg-muted text-sm whitespace-pre-wrap font-sans leading-relaxed">
                                    {tpl.templateText}
                                </pre>
                            )}

                            {/* Preview panel */}
                            {previewTarget?._id === tpl._id && previewData && (
                                <div className="mt-3 p-3 bg-background rounded-lg border border-line">
                                    <p className="text-xs text-fg-subtle mb-1">Prévisualisation ({previewData.characterCount} car.)</p>
                                    <pre className="text-green-600 dark:text-green-300 text-sm whitespace-pre-wrap font-sans">
                                        {previewData.rendered}
                                    </pre>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default RelanceSmsTemplatesPage;
