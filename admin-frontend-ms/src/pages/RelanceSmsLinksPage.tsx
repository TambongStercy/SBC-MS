import React, { useState, useEffect } from 'react';
import { Link2, Save, Loader2, RefreshCw, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { getSmsLinks, updateSmsLinks, getSmsTemplates, SmsLink, SmsTemplate } from '../services/adminRelanceApi';

const AUTO_DAYS = [0, 1, 2, 3, 4, 5, 6, 7];
const MANUAL_DAYS = [1, 2, 3, 4, 5, 6, 7];

const dayLabel = (type: 'auto' | 'manual', day: number) =>
    type === 'auto' ? (day === 0 ? 'J0 (15 min)' : `J${day}`) : `Jour ${day}`;

const RelanceSmsLinksPage: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'auto' | 'manual'>('auto');
    const [links, setLinks] = useState<Record<string, string>>({});
    const [templates, setTemplates] = useState<SmsTemplate[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            setLoading(true);
            const [linksData, templatesData] = await Promise.all([getSmsLinks(), getSmsTemplates()]);
            const map: Record<string, string> = {};
            linksData.forEach((l: SmsLink) => { map[`${l.type}:${l.dayNumber}`] = l.link; });
            setLinks(map);
            setTemplates(templatesData);
        } catch {
            toast.error('Erreur lors du chargement des liens SMS');
        } finally {
            setLoading(false);
        }
    };

    const days = activeTab === 'auto' ? AUTO_DAYS : MANUAL_DAYS;
    const tabTemplates = templates.filter(t => t.type === activeTab);

    const getTemplate = (day: number) => tabTemplates.find(t => t.dayNumber === day);
    const getLink = (day: number) => links[`${activeTab}:${day}`] || '';

    const setLink = (day: number, value: string) => {
        setLinks(prev => ({ ...prev, [`${activeTab}:${day}`]: value }));
        setSavedKeys(prev => { const n = new Set(prev); n.delete(`${activeTab}:${day}`); return n; });
    };

    const saveAll = async () => {
        setSaving(true);
        try {
            const payload: SmsLink[] = [];
            (['auto', 'manual'] as const).forEach(type => {
                const dayList = type === 'auto' ? AUTO_DAYS : MANUAL_DAYS;
                dayList.forEach(day => {
                    const link = links[`${type}:${day}`];
                    if (link?.trim()) payload.push({ type, dayNumber: day, link: link.trim() });
                });
            });
            await updateSmsLinks(payload);
            const currentKeys = days.map(d => `${activeTab}:${d}`);
            setSavedKeys(new Set(currentKeys));
            toast.success('Liens SMS sauvegardés');
        } catch {
            toast.error('Erreur lors de la sauvegarde');
        } finally {
            setSaving(false);
        }
    };

    const previewText = (day: number) => {
        const tpl = getTemplate(day);
        const link = getLink(day);
        if (!tpl) return null;
        return tpl.templateText.replace(/\{\{link\}\}/g, link || '{{link}}');
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
        );
    }

    return (
        <div className="p-6 max-w-4xl mx-auto">
            <div className="mb-6 flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                        <Link2 className="w-7 h-7 text-blue-400" />
                        Liens SMS par jour
                    </h1>
                    <p className="text-gray-400 mt-1 text-sm">
                        Ajoutez votre lien personnalisé pour chaque jour — il remplacera <code className="bg-gray-700 px-1 rounded">{'{{link}}'}</code> dans le message.
                    </p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={loadData}
                        className="p-2 rounded-lg bg-gray-700 text-gray-400 hover:text-white hover:bg-gray-600"
                        title="Recharger"
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                    <button
                        onClick={saveAll}
                        disabled={saving}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                    >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Tout sauvegarder
                    </button>
                </div>
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

            <div className="space-y-4">
                {days.map(day => {
                    const tpl = getTemplate(day);
                    const key = `${activeTab}:${day}`;
                    const saved = savedKeys.has(key);
                    const preview = previewText(day);

                    return (
                        <div key={day} className="bg-gray-800 rounded-xl border border-gray-700">
                            <div className="p-4 pb-3">
                                <div className="flex items-center gap-3 mb-3">
                                    <span className="bg-blue-600/20 text-blue-400 text-xs font-bold px-2 py-1 rounded">
                                        {dayLabel(activeTab, day)}
                                    </span>
                                    {!tpl?.active && (
                                        <span className="text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded">Template inactif</span>
                                    )}
                                    {saved && (
                                        <span className="text-xs text-green-400 flex items-center gap-1">
                                            <CheckCircle className="w-3.5 h-3.5" /> Sauvegardé
                                        </span>
                                    )}
                                </div>

                                {/* Template text preview */}
                                {tpl ? (
                                    <pre className="text-gray-400 text-xs whitespace-pre-wrap font-sans leading-relaxed mb-3 bg-gray-900 rounded-lg p-3 border border-gray-700">
                                        {tpl.templateText}
                                    </pre>
                                ) : (
                                    <p className="text-gray-500 text-xs italic mb-3">Aucun template pour ce jour</p>
                                )}

                                {/* Link input */}
                                <div className="flex items-center gap-2">
                                    <Link2 className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                    <input
                                        type="url"
                                        value={getLink(day)}
                                        onChange={e => setLink(day, e.target.value)}
                                        placeholder="https://votre-lien.com/..."
                                        className="flex-1 bg-gray-700 text-white text-sm rounded-lg px-3 py-2 border border-gray-600 focus:outline-none focus:border-blue-500"
                                    />
                                </div>

                                {/* Live preview with link injected */}
                                {preview && getLink(day) && (
                                    <div className="mt-3 p-3 bg-gray-900 rounded-lg border border-gray-700">
                                        <p className="text-xs text-gray-500 mb-1">Aperçu du message :</p>
                                        <pre className="text-green-300 text-xs whitespace-pre-wrap font-sans leading-relaxed">
                                            {preview}
                                        </pre>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="mt-6 flex justify-end">
                <button
                    onClick={saveAll}
                    disabled={saving}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 font-medium"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Sauvegarder tous les liens
                </button>
            </div>
        </div>
    );
};

export default RelanceSmsLinksPage;
