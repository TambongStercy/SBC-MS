import React from 'react';
import { Link } from 'react-router-dom';
import { Megaphone } from 'lucide-react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
import WhatsAppManager from '../components/WhatsAppManager';

/**
 * The platform's WhatsApp connection. The "Send Notification" form that used
 * to sit here was a mock — it reported "sent" and sent nothing — so it is
 * gone; announcements go through Push Announcements, which really sends.
 */
const NotificationsPage: React.FC = () => (
    <div className="text-fg">
        <h1 className="text-2xl md:text-3xl font-bold mb-6 text-fg">WhatsApp</h1>

        <div className="mb-8">
            <WhatsAppManager />
        </div>

        <div className="bg-surface border border-line rounded-lg p-5 flex items-start gap-4">
            <Megaphone className="text-blue-600 dark:text-blue-400 shrink-0" size={24} />
            <div>
                <h2 className="font-semibold">Envoyer une annonce aux membres</h2>
                <p className="text-sm text-fg-muted mt-1">Les annonces partent en notification sur le téléphone des membres.</p>
                <Link to="/notifications/push" className="inline-flex items-center gap-1 mt-3 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300">
                    Ouvrir les annonces <HugeiconsIcon icon={ArrowRight01Icon} size={16} />
                </Link>
            </div>
        </div>
    </div>
);

export default NotificationsPage;
