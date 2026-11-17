import { Link } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon, LockIcon, Megaphone02Icon } from '@hugeicons/core-free-icons';
import WhatsAppManager from '../components/WhatsAppManager';
import { Can } from '../components/Can';
import { Button, EmptyState, PageHeader, Panel, PanelBody, PanelHeader } from '../components/ui';

/**
 * Notifications: the server's WhatsApp connection (module `whatsapp`) and the
 * way to the push announcements (module `notifications`). The old "Send
 * Notification" form was a mock (it said "sent" and sent nothing), so
 * announcements go through Annonces push, which really sends.
 */
export default function NotificationsPage() {
    return (
        <div className="space-y-6">
            <PageHeader
                title="Notifications"
                description="La connexion WhatsApp qui envoie les messages du serveur, et les annonces aux membres."
                actions={(
                    <Can module="notifications" write>
                        <Button asChild variant="primary" size="lg" className="w-full sm:w-auto">
                            <Link to="/notifications/push">
                                <HugeiconsIcon icon={Megaphone02Icon} size={18} aria-hidden="true" />
                                Nouvelle annonce push
                            </Link>
                        </Button>
                    </Can>
                )}
            />

            <Can
                module="whatsapp"
                fallback={(
                    <Panel>
                        <EmptyState icon={LockIcon} title="Connexion WhatsApp non accessible" description="Votre compte n’a pas accès à l’espace WhatsApp. Demandez-le à un super administrateur." />
                    </Panel>
                )}
            >
                <WhatsAppManager />
            </Can>

            <Panel>
                <PanelHeader title="Annonces push" description="Une notification sur le téléphone des membres, à tous ou à un groupe (pays, abonnement, sexe)." />
                <PanelBody>
                    <Link to="/notifications/push" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:underline">
                        Voir et envoyer les annonces
                        <HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden="true" />
                    </Link>
                </PanelBody>
            </Panel>
        </div>
    );
}
