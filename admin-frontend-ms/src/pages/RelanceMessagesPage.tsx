import React, { useState, useEffect, useCallback } from 'react';
import { MessageSquare, Save, Eye, EyeOff, Image, Video, FileText, X, Plus, Loader2, Upload, Link, Palette, Monitor } from 'lucide-react';
import toast from 'react-hot-toast';
import { getAllMessages, upsertMessage, deactivateMessage, RelanceMessage, RelanceButton, uploadMediaFile, previewMessage } from '../services/adminRelanceApi';
import ConfirmationModal from '../components/common/ConfirmationModal';

const MEDIA_TYPE_LABELS: Record<string, string> = { image: 'Image', video: 'Vidéo', pdf: 'PDF' };

const RelanceMessagesPage: React.FC = () => {
    const [messages, setMessages] = useState<RelanceMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedDay, setSelectedDay] = useState<number>(1);
    const [saving, setSaving] = useState(false);

    // Confirmation modal
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmAction, setConfirmAction] = useState<{
        title: string;
        message: string;
        onConfirm: () => void;
    } | null>(null);

    // Form state
    const [subject, setSubject] = useState('');
    const [messageFr, setMessageFr] = useState('');
    const [messageEn, setMessageEn] = useState('');
    const [mediaUrls, setMediaUrls] = useState<{ url: string; type: 'image' | 'video' | 'pdf'; filename?: string }[]>([]);
    const [active, setActive] = useState(true);
    const [buttons, setButtons] = useState<RelanceButton[]>([]);

    // Preview state
    const [previewHtml, setPreviewHtml] = useState<string>('');
    const [showPreview, setShowPreview] = useState(false);
    const [loadingPreview, setLoadingPreview] = useState(false);

    useEffect(() => {
        loadMessages();
    }, []);

    useEffect(() => {
        // Load selected day's message into form
        const dayMessage = messages.find(m => m.dayNumber === selectedDay);
        if (dayMessage) {
            setMessageFr(dayMessage.messageTemplate.fr);
            setMessageEn(dayMessage.messageTemplate.en);
            setMediaUrls(dayMessage.mediaUrls);
            setActive(dayMessage.active);
            setSubject(dayMessage.subject || '');
            setButtons(dayMessage.buttons || []);
        } else {
            // Reset form for new message
            setMessageFr('');
            setMessageEn('');
            setMediaUrls([]);
            setActive(true);
            setSubject('');
            setButtons([]);
        }
        setPreviewHtml('');
        setShowPreview(false);
    }, [selectedDay, messages]);

    const loadMessages = async () => {
        try {
            setLoading(true);
            const data = await getAllMessages();
            setMessages(data);
        } catch (error: any) {
            console.error('Error loading messages:', error);
            toast.error('Impossible de charger les messages : ' + (error.response?.data?.message || error.message));
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!messageFr.trim() || !messageEn.trim()) {
            toast.error('Les messages en français et en anglais sont obligatoires');
            return;
        }

        // Validate buttons
        for (const btn of buttons) {
            if (!btn.label.trim() || !btn.url.trim()) {
                toast.error('Chaque bouton doit avoir un libellé et une URL');
                return;
            }
        }

        try {
            setSaving(true);
            const messageData: Omit<RelanceMessage, '_id' | 'createdAt' | 'updatedAt'> = {
                dayNumber: selectedDay,
                subject: subject.trim() || undefined,
                messageTemplate: {
                    fr: messageFr,
                    en: messageEn
                },
                mediaUrls: mediaUrls,
                buttons: buttons,
                variables: ['{{name}}', '{{referrerName}}', '{{day}}'],
                active: active
            };

            await upsertMessage(messageData);
            toast.success(`Message du jour ${selectedDay} enregistré`);
            await loadMessages();
        } catch (error: any) {
            console.error('Error saving message:', error);
            toast.error("Impossible d'enregistrer le message : " + (error.response?.data?.message || error.message));
        } finally {
            setSaving(false);
        }
    };

    const handleDeactivate = async () => {
        setConfirmAction({
            title: 'Désactiver le message',
            message: `Voulez-vous vraiment désactiver le message du jour ${selectedDay} ?`,
            onConfirm: async () => {
                try {
                    setSaving(true);
                    await deactivateMessage(selectedDay);
                    toast.success(`Message du jour ${selectedDay} désactivé`);
                    await loadMessages();
                    setShowConfirmModal(false);
                } catch (error: any) {
                    console.error('Error deactivating message:', error);
                    toast.error('Impossible de désactiver le message : ' + (error.response?.data?.message || error.message));
                } finally {
                    setSaving(false);
                }
            }
        });
        setShowConfirmModal(true);
    };

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (file.size > 50 * 1024 * 1024) {
            toast.error('Le fichier doit faire moins de 50 Mo');
            return;
        }

        try {
            setSaving(true);
            const uploadedMedia = await uploadMediaFile(file);
            setMediaUrls([...mediaUrls, {
                url: uploadedMedia.url,
                type: uploadedMedia.type,
                filename: uploadedMedia.filename
            }]);
            toast.success(`${file.name} envoyé`);
            event.target.value = '';
        } catch (error: any) {
            console.error('Error uploading file:', error);
            toast.error("Impossible d'envoyer le fichier : " + (error.response?.data?.message || error.message));
        } finally {
            setSaving(false);
        }
    };

    const handleRemoveMedia = (index: number) => {
        setMediaUrls(mediaUrls.filter((_, i) => i !== index));
    };

    // Button management
    const handleAddButton = () => {
        setButtons([...buttons, { label: '', url: '', color: '#F59E0B' }]);
    };

    const handleRemoveButton = (index: number) => {
        setButtons(buttons.filter((_, i) => i !== index));
    };

    const handleButtonChange = (index: number, field: keyof RelanceButton, value: string) => {
        const updated = [...buttons];
        updated[index] = { ...updated[index], [field]: value };
        setButtons(updated);
    };

    // Preview
    const handlePreview = useCallback(async () => {
        if (!messageFr.trim()) {
            toast.error("Saisissez un message en français pour l'aperçu");
            return;
        }

        try {
            setLoadingPreview(true);
            const html = await previewMessage({
                dayNumber: selectedDay,
                subject: subject.trim() || undefined,
                messageTemplate: { fr: messageFr, en: messageEn },
                mediaUrls: mediaUrls.map(m => ({ url: m.url, type: m.type })),
                buttons: buttons.filter(b => b.label.trim() && b.url.trim()),
                recipientName: 'John Doe',
                referrerName: 'Jane Smith'
            });
            setPreviewHtml(html);
            setShowPreview(true);
        } catch (error: any) {
            console.error('Error generating preview:', error);
            toast.error("Impossible de générer l'aperçu : " + (error.response?.data?.message || error.message));
        } finally {
            setLoadingPreview(false);
        }
    }, [selectedDay, messageFr, messageEn, mediaUrls, buttons]);

    const getMediaIcon = (type: string) => {
        switch (type) {
            case 'image': return <Image size={16} />;
            case 'video': return <Video size={16} />;
            case 'pdf': return <FileText size={16} />;
            default: return <FileText size={16} />;
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="animate-spin text-blue-500" size={48} />
            </div>
        );
    }

    return (
        <div>
            <div className="mb-6">
                <h1 className="text-2xl font-semibold tracking-tight text-fg flex items-center gap-2">
                    <MessageSquare size={28} className="text-blue-500" />
                    Messages de relance
                </h1>
                <p className="text-fg-muted mt-2">Configurez l'e-mail envoyé chaque jour de la boucle de relance de 7 jours</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Day Selector */}
                <div className="bg-surface rounded-lg p-6 border border-line lg:col-span-1">
                    <h2 className="text-lg font-semibold text-fg mb-4">Choisir le jour</h2>
                    <div className="space-y-2">
                        {[1, 2, 3, 4, 5, 6, 7].map(day => {
                            const dayMessage = messages.find(m => m.dayNumber === day);
                            const isActive = dayMessage?.active ?? false;
                            const isSelected = selectedDay === day;

                            return (
                                <button
                                    key={day}
                                    onClick={() => setSelectedDay(day)}
                                    className={`w-full p-3 rounded-lg border transition-all flex items-center justify-between ${
                                        isSelected
                                            ? 'bg-blue-600 border-blue-500 text-white'
                                            : 'bg-surface-2 border-line-strong text-fg-muted hover:bg-surface-3'
                                    }`}
                                >
                                    <span className="font-medium">Jour {day}</span>
                                    <span className="flex items-center gap-2">
                                        {dayMessage ? (
                                            isActive ? (
                                                <Eye size={16} className="text-green-600 dark:text-green-400" />
                                            ) : (
                                                <EyeOff size={16} className="text-fg-subtle" />
                                            )
                                        ) : (
                                            <span className="text-xs text-fg-subtle">Non configuré</span>
                                        )}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Message Editor */}
                <div className="bg-surface rounded-lg p-6 border border-line lg:col-span-2">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-fg">Message du jour {selectedDay}</h2>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={handlePreview}
                                disabled={loadingPreview}
                                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 text-white rounded-lg flex items-center gap-2 text-sm transition-colors"
                            >
                                {loadingPreview ? <Loader2 size={14} className="animate-spin" /> : <Monitor size={14} />}
                                Aperçu de l'e-mail
                            </button>
                            <label className="flex items-center gap-2 text-sm text-fg-muted">
                                <input
                                    type="checkbox"
                                    checked={active}
                                    onChange={(e) => setActive(e.target.checked)}
                                    className="rounded-sm"
                                />
                                Actif
                            </label>
                        </div>
                    </div>

                    {/* Subject Line */}
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-fg-muted mb-2">
                            Objet de l'e-mail (facultatif, remplace l'objet par défaut)
                        </label>
                        <input
                            type="text"
                            value={subject}
                            onChange={(e) => setSubject(e.target.value)}
                            className="w-full px-3 py-2 bg-surface border border-line-strong rounded-lg text-fg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                            placeholder="Objet personnalisé… Laissez vide pour l'objet automatique"
                        />
                    </div>

                    {/* French Message */}
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-fg-muted mb-2">
                            Message (français)
                        </label>
                        <textarea
                            value={messageFr}
                            onChange={(e) => setMessageFr(e.target.value)}
                            rows={5}
                            className="w-full px-3 py-2 bg-surface border border-line-strong rounded-lg text-fg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                            placeholder="Message en français… Variables : {{name}}, {{referrerName}}, {{day}}"
                        />
                    </div>

                    {/* English Message */}
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-fg-muted mb-2">
                            Message (anglais)
                        </label>
                        <textarea
                            value={messageEn}
                            onChange={(e) => setMessageEn(e.target.value)}
                            rows={5}
                            className="w-full px-3 py-2 bg-surface border border-line-strong rounded-lg text-fg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                            placeholder="Message en anglais… Variables : {{name}}, {{referrerName}}, {{day}}"
                        />
                    </div>

                    {/* CTA Buttons Editor */}
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-fg-muted mb-2">
                            Boutons d'action
                        </label>
                        {buttons.length > 0 && (
                            <div className="space-y-3 mb-3">
                                {buttons.map((btn, index) => (
                                    <div key={index} className="p-3 bg-surface-2 rounded-lg border border-line-strong">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="text-xs text-fg-muted font-medium">Bouton {index + 1}</span>
                                            <button
                                                onClick={() => handleRemoveButton(index)}
                                                aria-label="Retirer le bouton"
                                                className="ml-auto text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                                            >
                                                <X size={16} />
                                            </button>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                            <div>
                                                <label className="block text-xs text-fg-subtle mb-1">Libellé</label>
                                                <div className="relative">
                                                    <input
                                                        type="text"
                                                        value={btn.label}
                                                        onChange={(e) => handleButtonChange(index, 'label', e.target.value)}
                                                        placeholder="ex. Payer maintenant"
                                                        className="w-full px-3 py-1.5 bg-surface border border-line-strong rounded-sm text-fg text-sm focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                                                    />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="block text-xs text-fg-subtle mb-1">URL</label>
                                                <div className="relative">
                                                    <input
                                                        type="url"
                                                        value={btn.url}
                                                        onChange={(e) => handleButtonChange(index, 'url', e.target.value)}
                                                        placeholder="https://..."
                                                        className="w-full px-3 py-1.5 bg-surface border border-line-strong rounded-sm text-fg text-sm focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                                                    />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="block text-xs text-fg-subtle mb-1">Couleur</label>
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="color"
                                                        value={btn.color || '#F59E0B'}
                                                        onChange={(e) => handleButtonChange(index, 'color', e.target.value)}
                                                        className="w-8 h-8 rounded-sm cursor-pointer border-0 bg-transparent"
                                                    />
                                                    <input
                                                        type="text"
                                                        value={btn.color || '#F59E0B'}
                                                        onChange={(e) => handleButtonChange(index, 'color', e.target.value)}
                                                        className="flex-1 px-3 py-1.5 bg-surface border border-line-strong rounded-sm text-fg text-sm focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                        {/* Button preview */}
                                        {btn.label && (
                                            <div className="mt-2 flex items-center gap-2">
                                                <span className="text-xs text-fg-subtle">Aperçu :</span>
                                                <span
                                                    className="inline-block px-4 py-1 rounded-full text-white text-xs font-semibold"
                                                    style={{ backgroundColor: btn.color || '#F59E0B' }}
                                                >
                                                    {btn.label}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                        <button
                            onClick={handleAddButton}
                            className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg flex items-center gap-2 text-sm transition-colors"
                        >
                            <Plus size={16} />
                            Ajouter un bouton
                        </button>
                        <p className="text-xs text-fg-muted mt-2">Ajoutez des boutons d'action à l'e-mail (ex. « Payer maintenant », « Voir le tableau de bord »)</p>
                    </div>

                    {/* Media URLs */}
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-fg-muted mb-2">
                            Pièces jointes
                        </label>

                        {/* Existing Media */}
                        {mediaUrls.length > 0 && (
                            <div className="space-y-2 mb-3">
                                {mediaUrls.map((media, index) => (
                                    <div key={index} className="flex items-center gap-2 p-2 bg-surface-2 rounded-sm border border-line-strong">
                                        {getMediaIcon(media.type)}
                                        <span className="flex-1 text-sm text-fg-muted truncate">{media.url}</span>
                                        <span className="text-xs text-fg-subtle">{MEDIA_TYPE_LABELS[media.type] ?? media.type}</span>
                                        <button
                                            onClick={() => handleRemoveMedia(index)}
                                            aria-label="Retirer le média"
                                            className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                                        >
                                            <X size={16} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Upload Media */}
                        <div className="flex gap-2">
                            <label className="flex-1 cursor-pointer">
                                <div className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center justify-center gap-2 transition-colors">
                                    <Upload size={16} />
                                    <span>Envoyer un média (image, vidéo, PDF)</span>
                                </div>
                                <input
                                    type="file"
                                    accept="image/*,video/*,.pdf"
                                    onChange={handleFileUpload}
                                    className="hidden"
                                    disabled={saving}
                                />
                            </label>
                        </div>
                        <p className="text-xs text-fg-muted mt-2">Taille max. : 50 Mo. Formats : images, vidéos, PDF</p>
                    </div>

                    {/* Available Variables */}
                    <div className="mb-6 p-3 bg-surface-2 rounded-sm border border-line-strong">
                        <p className="text-xs text-fg-muted mb-1">Variables disponibles :</p>
                        <div className="flex gap-2 flex-wrap">
                            <code className="text-xs bg-surface px-2 py-1 rounded-sm text-blue-600 dark:text-blue-400">{'{{name}}'}</code>
                            <code className="text-xs bg-surface px-2 py-1 rounded-sm text-blue-600 dark:text-blue-400">{'{{referrerName}}'}</code>
                            <code className="text-xs bg-surface px-2 py-1 rounded-sm text-blue-600 dark:text-blue-400">{'{{day}}'}</code>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-3">
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 text-white rounded-lg flex items-center justify-center gap-2 transition-colors"
                        >
                            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                            {saving ? 'Enregistrement…' : 'Enregistrer le message'}
                        </button>
                        {messages.find(m => m.dayNumber === selectedDay) && (
                            <button
                                onClick={handleDeactivate}
                                disabled={saving}
                                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 text-white rounded-lg flex items-center gap-2 transition-colors"
                            >
                                <EyeOff size={16} />
                                Désactiver
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Email Preview Modal */}
            {showPreview && previewHtml && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowPreview(false)}>
                    <div className="bg-surface rounded-lg max-w-3xl w-full max-h-[90vh] flex flex-col m-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-4 border-b border-line">
                            <h2 className="text-lg font-semibold text-fg flex items-center gap-2">
                                <Monitor size={20} className="text-purple-600 dark:text-purple-400" />
                                Aperçu de l'e-mail - Jour {selectedDay}
                            </h2>
                            <button
                                onClick={() => setShowPreview(false)}
                                aria-label="Fermer"
                                className="text-fg-muted hover:text-fg"
                            >
                                <X size={24} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-hidden p-4">
                            <div className="bg-white rounded-lg overflow-hidden h-full">
                                <iframe
                                    srcDoc={previewHtml}
                                    className="w-full border-0"
                                    style={{ height: 'calc(90vh - 120px)' }}
                                    title="Aperçu de l'e-mail"
                                    sandbox="allow-same-origin"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Confirmation Modal */}
            {confirmAction && (
                <ConfirmationModal
                    isOpen={showConfirmModal}
                    title={confirmAction.title}
                    message={confirmAction.message}
                    confirmText="Confirmer"
                    cancelText="Annuler"
                    onConfirm={confirmAction.onConfirm}
                    onCancel={() => setShowConfirmModal(false)}
                />
            )}
        </div>
    );
};

export default RelanceMessagesPage;
