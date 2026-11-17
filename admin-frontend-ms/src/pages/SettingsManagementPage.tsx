import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { Add01Icon, File01Icon, Image01Icon, Pdf01Icon, Video01Icon } from '@hugeicons/core-free-icons';
import {
    getSettings, uploadCompanyLogo, uploadPresentationPdf, uploadPresentationVideo, uploadTermsPdf, type ISettings,
} from '../services/adminSettingsApi';
import { Can } from '../components/Can';
import { Button, PageHeader, Panel, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui';
import { ErrorState } from '../components/display/ErrorState';
import { apiError } from '../components/display/format';
import { useUrlParams } from '../components/display/useUrlParams';
import { FormationsSection } from '../components/settings/FormationsSection';
import { EventsSection } from '../components/settings/EventsSection';
import { FileUploadCard } from '../components/settings/FileUploadCard';
import { WinnerVipLinkCard } from '../components/settings/WinnerVipLinkCard';

const SETTINGS_KEY = ['admin-settings', 'main'] as const;
const TABS = ['formations', 'evenements', 'fichiers', 'winner'] as const;
type Tab = typeof TABS[number];
const DEFAULTS = { onglet: 'formations', page: '1' };

/**
 * Réglages (module `settings`): what members see that is not tied to one
 * member — formations, community events, official files, the Winner VIP
 * group link. Server: settings-service /settings/*.
 */
export default function SettingsManagementPage() {
    const queryClient = useQueryClient();
    const params = useUrlParams(DEFAULTS);
    const raw = params.get('onglet');
    const tab: Tab = (TABS as readonly string[]).includes(raw) ? raw as Tab : 'formations';
    const eventPage = Math.max(1, Number(params.get('page')) || 1);
    const [creating, setCreating] = useState<'formation' | 'event' | null>(null);

    const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: getSettings });
    const onSaved = (updated: ISettings) => queryClient.setQueryData(SETTINGS_KEY, updated);

    const primary = tab === 'formations'
        ? { label: 'Ajouter une formation', open: () => setCreating('formation') }
        : tab === 'evenements'
            ? { label: 'Publier un événement', open: () => setCreating('event') }
            : null;

    const settingsBlock = (node: (s: ISettings | null) => ReactNode) => {
        if (settings.isLoading) return <Skeleton className="h-48 w-full rounded-panel" />;
        if (settings.isError) {
            return (
                <Panel>
                    <ErrorState message={apiError(settings.error, 'Les réglages n’ont pas pu être chargés.')} onRetry={() => void settings.refetch()} retrying={settings.isFetching} />
                </Panel>
            );
        }
        return node(settings.data ?? null);
    };

    return (
        <div className="space-y-6">
            <PageHeader
                title="Réglages"
                description="Ce que tous les membres retrouvent dans l’application : formations, événements, fichiers officiels et groupe VIP Winner."
                actions={primary && (
                    <Can module="settings" write>
                        <Button variant="primary" size="lg" className="w-full sm:w-auto" onClick={primary.open}>
                            <HugeiconsIcon icon={Add01Icon} size={18} aria-hidden="true" />
                            {primary.label}
                        </Button>
                    </Can>
                )}
            />

            <Tabs value={tab} onValueChange={v => params.set({ onglet: v })}>
                <TabsList aria-label="Sections des réglages" className="pb-px [scrollbar-width:none]">
                    <TabsTrigger value="formations" className="px-2 pt-3 sm:px-3">Formations</TabsTrigger>
                    <TabsTrigger value="evenements" className="px-2 pt-3 sm:px-3">Événements</TabsTrigger>
                    <TabsTrigger value="fichiers" className="px-2 pt-3 sm:px-3">Fichiers</TabsTrigger>
                    <TabsTrigger value="winner" className="px-2 pt-3 sm:px-3">Pack Winner</TabsTrigger>
                </TabsList>

                <TabsContent value="formations" className="pt-5">
                    <FormationsSection createOpen={creating === 'formation'} onCreateOpenChange={o => setCreating(o ? 'formation' : null)} />
                </TabsContent>

                <TabsContent value="evenements" className="pt-5">
                    <EventsSection
                        page={eventPage}
                        onPageChange={p => params.set({ page: String(p) })}
                        createOpen={creating === 'event'}
                        onCreateOpenChange={o => setCreating(o ? 'event' : null)}
                    />
                </TabsContent>

                <TabsContent value="fichiers" className="pt-5">
                    {settingsBlock(s => (
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            <FileUploadCard
                                title="Logo de l’entreprise"
                                description="Le logo principal de l’application."
                                icon={Image01Icon}
                                current={s?.companyLogo}
                                upload={uploadCompanyLogo}
                                onUploaded={onSaved}
                                accept={{ 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'] }}
                                hint="PNG, JPG, GIF ou WEBP"
                            />
                            <FileUploadCard
                                title="Conditions générales"
                                description="Le document officiel que les membres acceptent."
                                icon={Pdf01Icon}
                                current={s?.termsAndConditionsPdf}
                                upload={uploadTermsPdf}
                                onUploaded={onSaved}
                                accept={{ 'application/pdf': ['.pdf'] }}
                                hint="PDF uniquement"
                            />
                            <FileUploadCard
                                title="Présentation (PDF)"
                                description="La présentation de SBC à partager."
                                icon={File01Icon}
                                current={s?.presentationPdf}
                                upload={uploadPresentationPdf}
                                onUploaded={onSaved}
                                accept={{ 'application/pdf': ['.pdf'] }}
                                hint="PDF uniquement"
                            />
                            <FileUploadCard
                                title="Vidéo de présentation"
                                description="Une vidéo lourde coûte à chaque lecture : préférez un fichier compressé."
                                icon={Video01Icon}
                                current={s?.presentationVideo}
                                upload={uploadPresentationVideo}
                                onUploaded={onSaved}
                                accept={{ 'video/*': ['.mp4', '.webm'] }}
                                hint="MP4 ou WEBM"
                            />
                        </div>
                    ))}
                </TabsContent>

                <TabsContent value="winner" className="pt-5">
                    {settingsBlock(s => <WinnerVipLinkCard value={s?.winnerVipGroupUrl} onSaved={onSaved} />)}
                </TabsContent>
            </Tabs>
        </div>
    );
}
