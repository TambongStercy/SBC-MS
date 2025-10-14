import React, { useState, useEffect } from 'react';
import { MessageSquare, Save, Eye, EyeOff, Image, Video, FileText, X, Plus, Loader2, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { getAllMessages, upsertMessage, deactivateMessage, RelanceMessage, uploadMediaFile } from '../services/adminRelanceApi';

const RelanceMessagesPage: React.FC = () => {
    const [messages, setMessages] = useState<RelanceMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedDay, setSelectedDay] = useState<number>(1);
    const [saving, setSaving] = useState(false);

    // Form state
    const [messageFr, setMessageFr] = useState('');
    const [messageEn, setMessageEn] = useState('');
    const [mediaUrls, setMediaUrls] = useState<{ url: string; type: 'image' | 'video' | 'pdf'; filename?: string }[]>([]);
    const [active, setActive] = useState(true);
    const [newMediaUrl, setNewMediaUrl] = useState('');
    const [newMediaType, setNewMediaType] = useState<'image' | 'video' | 'pdf'>('image');
    const [newMediaFilename, setNewMediaFilename] = useState('');

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
        } else {
            // Reset form for new message
            setMessageFr('');
            setMessageEn('');
            setMediaUrls([]);
            setActive(true);
        }
    }, [selectedDay, messages]);

    const loadMessages = async () => {
        try {
            setLoading(true);
            const data = await getAllMessages();
            setMessages(data);
        } catch (error: any) {
            console.error('Error loading messages:', error);
            toast.error('Failed to load messages: ' + (error.response?.data?.message || error.message));
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!messageFr.trim() || !messageEn.trim()) {
            toast.error('Both French and English messages are required');
            return;
        }

        try {
            setSaving(true);
            const messageData: Omit<RelanceMessage, '_id' | 'createdAt' | 'updatedAt'> = {
                dayNumber: selectedDay,
                messageTemplate: {
                    fr: messageFr,
                    en: messageEn
                },
                mediaUrls: mediaUrls,
                variables: ['{{name}}', '{{referrerName}}', '{{day}}'],
                active: active
            };

            await upsertMessage(messageData);
            toast.success(`Day ${selectedDay} message saved successfully`);
            await loadMessages();
        } catch (error: any) {
            console.error('Error saving message:', error);
            toast.error('Failed to save message: ' + (error.response?.data?.message || error.message));
        } finally {
            setSaving(false);
        }
    };

    const handleDeactivate = async () => {
        if (!window.confirm(`Are you sure you want to deactivate Day ${selectedDay} message?`)) {
            return;
        }

        try {
            setSaving(true);
            await deactivateMessage(selectedDay);
            toast.success(`Day ${selectedDay} message deactivated`);
            await loadMessages();
        } catch (error: any) {
            console.error('Error deactivating message:', error);
            toast.error('Failed to deactivate message: ' + (error.response?.data?.message || error.message));
        } finally {
            setSaving(false);
        }
    };

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        // Validate file size (50MB max)
        if (file.size > 50 * 1024 * 1024) {
            toast.error('File size must be less than 50MB');
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

            toast.success(`${file.name} uploaded successfully`);
            event.target.value = ''; // Reset file input
        } catch (error: any) {
            console.error('Error uploading file:', error);
            toast.error('Failed to upload file: ' + (error.response?.data?.message || error.message));
        } finally {
            setSaving(false);
        }
    };

    const handleRemoveMedia = (index: number) => {
        setMediaUrls(mediaUrls.filter((_, i) => i !== index));
    };

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
            <div className="flex items-center justify-center h-screen">
                <Loader2 className="animate-spin text-blue-500" size={48} />
            </div>
        );
    }

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <div className="mb-6">
                <h1 className="text-3xl font-bold text-gray-100 flex items-center gap-2">
                    <MessageSquare size={32} className="text-blue-500" />
                    Relance Message Templates
                </h1>
                <p className="text-gray-400 mt-2">Configure WhatsApp messages for each day of the 7-day follow-up loop</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Day Selector */}
                <div className="bg-gray-800 rounded-lg p-6 border border-gray-700 lg:col-span-1">
                    <h2 className="text-lg font-semibold text-gray-100 mb-4">Select Day</h2>
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
                                            : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-650'
                                    }`}
                                >
                                    <span className="font-medium">Day {day}</span>
                                    <span className="flex items-center gap-2">
                                        {dayMessage ? (
                                            isActive ? (
                                                <Eye size={16} className="text-green-400" />
                                            ) : (
                                                <EyeOff size={16} className="text-gray-500" />
                                            )
                                        ) : (
                                            <span className="text-xs text-gray-500">Not configured</span>
                                        )}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Message Editor */}
                <div className="bg-gray-800 rounded-lg p-6 border border-gray-700 lg:col-span-2">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-gray-100">Day {selectedDay} Message</h2>
                        <div className="flex items-center gap-2">
                            <label className="flex items-center gap-2 text-sm text-gray-300">
                                <input
                                    type="checkbox"
                                    checked={active}
                                    onChange={(e) => setActive(e.target.checked)}
                                    className="rounded"
                                />
                                Active
                            </label>
                        </div>
                    </div>

                    {/* French Message */}
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            Message (French)
                        </label>
                        <textarea
                            value={messageFr}
                            onChange={(e) => setMessageFr(e.target.value)}
                            rows={5}
                            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Enter French message... Use {{name}}, {{referrerName}}, {{day}} as variables"
                        />
                    </div>

                    {/* English Message */}
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            Message (English)
                        </label>
                        <textarea
                            value={messageEn}
                            onChange={(e) => setMessageEn(e.target.value)}
                            rows={5}
                            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Enter English message... Use {{name}}, {{referrerName}}, {{day}} as variables"
                        />
                    </div>

                    {/* Media URLs */}
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            Media Attachments
                        </label>

                        {/* Existing Media */}
                        {mediaUrls.length > 0 && (
                            <div className="space-y-2 mb-3">
                                {mediaUrls.map((media, index) => (
                                    <div key={index} className="flex items-center gap-2 p-2 bg-gray-700 rounded border border-gray-600">
                                        {getMediaIcon(media.type)}
                                        <span className="flex-1 text-sm text-gray-300 truncate">{media.url}</span>
                                        <span className="text-xs text-gray-500">{media.type}</span>
                                        <button
                                            onClick={() => handleRemoveMedia(index)}
                                            className="text-red-400 hover:text-red-300"
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
                                    <span>Upload Media (Image/Video/PDF)</span>
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
                        <p className="text-xs text-gray-400 mt-2">Max file size: 50MB. Supported: Images, Videos, PDFs</p>
                    </div>

                    {/* Available Variables */}
                    <div className="mb-6 p-3 bg-gray-700 rounded border border-gray-600">
                        <p className="text-xs text-gray-400 mb-1">Available variables:</p>
                        <div className="flex gap-2 flex-wrap">
                            <code className="text-xs bg-gray-800 px-2 py-1 rounded text-blue-400">{'{{name}}'}</code>
                            <code className="text-xs bg-gray-800 px-2 py-1 rounded text-blue-400">{'{{referrerName}}'}</code>
                            <code className="text-xs bg-gray-800 px-2 py-1 rounded text-blue-400">{'{{day}}'}</code>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-3">
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded-lg flex items-center justify-center gap-2 transition-colors"
                        >
                            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                            {saving ? 'Saving...' : 'Save Message'}
                        </button>
                        {messages.find(m => m.dayNumber === selectedDay) && (
                            <button
                                onClick={handleDeactivate}
                                disabled={saving}
                                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white rounded-lg flex items-center gap-2 transition-colors"
                            >
                                <EyeOff size={16} />
                                Deactivate
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RelanceMessagesPage;