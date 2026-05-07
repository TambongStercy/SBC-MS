import React, { useState, useEffect } from 'react';
import { MessageSquare, Edit2, Eye, Save, X, ToggleLeft, ToggleRight, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
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
            toast.error('Erreur lors du chargement des templates SMS');
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
            toast.success('Template mis à jour');
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
            toast.success(updated.active ? 'Template activé' : 'Template désactivé');
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
        <div className="p-6 max-w-4xl mx-auto">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                    <MessageSquare className="w-7 h-7 text-blue-400" />
                    Templates SMS Relance
                </h1>
                <p className="text-gray-400 mt-1 text-sm">
                    Messages prédéfinis — les utilisateurs ajoutent uniquement leur lien via <code className="bg-gray-700 px-1 rounded">{'{{link}}'}</code>
                </p>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 mb-6">
                {(['auto', 'manual'] as const).map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                            activeTab === tab
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                    >
                        {tab === 'auto' ? '🤖 Automatique (J0–J7)' : '✍️ Manuel (Jour 1–7)'}
                    </button>
                ))}
            </div>

            {/* Preview link input */}
            <div className="bg-gray-800 rounded-lg p-4 mb-4 flex items-center gap-3">
                <Eye className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <span className="text-gray-400 text-sm">Lien pour prévisualisation :</span>
                <input
                    value={previewLink}
                    onChange={e => setPreviewLink(e.target.value)}
                    className="flex-1 bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:outline-none focus:border-blue-500"
                    placeholder="https://..."
                />
            </div>

            {/* Template list */}
            <div className="space-y-4">
                {filtered.map(tpl => (
                    <div key={tpl._id} className={`bg-gray-800 rounded-xl border ${tpl.active ? 'border-gray-700' : 'border-gray-700 opacity-60'}`}>
                        <div className="flex items-center justify-between p-4 pb-2">
                            <div className="flex items-center gap-3">
                                <span className="bg-blue-600/20 text-blue-400 text-xs font-bold px-2 py-1 rounded">
                                    {dayLabel(tpl.type, tpl.dayNumber)}
                                </span>
                                {!tpl.active && (
                                    <span className="text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded">Inactif</span>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => handlePreview(tpl)}
                                    className="p-1.5 rounded text-gray-400 hover:text-blue-400 hover:bg-gray-700"
                                    title="Prévisualiser"
                                >
                                    <Eye className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => toggleActive(tpl)}
                                    className="p-1.5 rounded text-gray-400 hover:text-yellow-400 hover:bg-gray-700"
                                    title={tpl.active ? 'Désactiver' : 'Activer'}
                                >
                                    {tpl.active
                                        ? <ToggleRight className="w-5 h-5 text-green-400" />
                                        : <ToggleLeft className="w-5 h-5 text-gray-500" />}
                                </button>
                                {editingId !== tpl._id && (
                                    <button
                                        onClick={() => startEdit(tpl)}
                                        className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700"
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
                                        className="w-full bg-gray-900 text-white text-sm rounded-lg p-3 border border-blue-500 focus:outline-none resize-none font-mono"
                                    />
                                    <div className="flex items-center justify-between">
                                        <span className={`text-xs ${charCount(editText) > 160 ? 'text-orange-400' : 'text-gray-400'}`}>
                                            {charCount(editText)} caractères ({Math.ceil(charCount(editText) / 160)} SMS)
                                        </span>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={cancelEdit}
                                                className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600"
                                            >
                                                <X className="w-3.5 h-3.5" /> Annuler
                                            </button>
                                            <button
                                                onClick={() => saveEdit(tpl)}
                                                disabled={saving}
                                                className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                                            >
                                                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                                Sauvegarder
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <pre className="text-gray-300 text-sm whitespace-pre-wrap font-sans leading-relaxed">
                                    {tpl.templateText}
                                </pre>
                            )}

                            {/* Preview panel */}
                            {previewTarget?._id === tpl._id && previewData && (
                                <div className="mt-3 p-3 bg-gray-900 rounded-lg border border-gray-700">
                                    <p className="text-xs text-gray-500 mb-1">Prévisualisation ({previewData.characterCount} car.)</p>
                                    <pre className="text-green-300 text-sm whitespace-pre-wrap font-sans">
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
