import React from 'react';
import { Link } from 'react-router-dom';
import { Megaphone } from 'lucide-react';
import WhatsAppManager from '../components/WhatsAppManager';

/**
 * The platform's WhatsApp connection. The "Send Notification" form that used
 * to sit here was a mock — it reported "sent" and sent nothing — so it is
 * gone; announcements go through Push Announcements, which really sends.
 */
const NotificationsPage: React.FC = () => (
    <div className="flex-1 overflow-auto relative z-10 bg-gray-900 text-white p-4 md:p-8">
        <h1 className="text-2xl md:text-3xl font-bold mb-6 text-white">WhatsApp</h1>

        <div className="max-w-4xl mx-auto mb-8">
            <WhatsAppManager />
        </div>

        <div className="max-w-4xl mx-auto bg-gray-800 rounded-lg p-5 flex items-start gap-4">
            <Megaphone className="text-blue-400 shrink-0" size={24} />
            <div>
                <h2 className="font-semibold">Envoyer une annonce aux membres</h2>
                <p className="text-sm text-gray-400 mt-1">Les annonces partent en notification sur le téléphone des membres.</p>
                <Link to="/notifications/push" className="inline-block mt-3 text-sm font-semibold text-blue-400 hover:text-blue-300">
                    Ouvrir les annonces →
                </Link>
            </div>
        </div>
    </div>
);

export default NotificationsPage;
