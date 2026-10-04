import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { approveAdsCampaign, getAdsCampaignPerformance, rejectAdsCampaign, type AdsCampaign } from '../../../api/adsNetwork';
import { Badge, Button, ConfirmSheet, KeyValue, MemberLink, SectionTitle, Sheet, StatusBadge, Spinner, notify } from '../../../ui';
import { formatDate, formatMoney, formatNumber, formatPhone } from '../../../lib/format';
import { countryName } from '../../../lib/labels';
import { CAMPAIGN_STATUS, PARTICIPATION_STATUS, fileUrl } from './shared';

const REFUSE = ['La créative ne respecte pas les règles', 'Le ciblage ne trouvera pas assez de diffuseurs', 'Contenu trompeur ou interdit', 'Informations de contact manquantes'];

function targetingText(c: AdsCampaign): Array<[string, string]> {
    const t = c.targeting || {};
    const rows: Array<[string, string]> = [];
    if (t.countries?.length) rows.push(['Pays', t.countries.map(countryName).join(', ')]);
    if (t.cities?.length) rows.push(['Villes', t.cities.join(', ')]);
    if (t.sex?.length) rows.push(['Sexe', t.sex.map(s => (s === 'female' ? 'Femmes' : s === 'male' ? 'Hommes' : s)).join(', ')]);
    if (t.minAge || t.maxAge) rows.push(['Âge', `${t.minAge ?? '…'} – ${t.maxAge ?? '…'} ans`]);
    if (t.interests?.length) rows.push(['Intérêts', t.interests.join(', ')]);
    if (t.professions?.length) rows.push(['Professions', t.professions.join(', ')]);
    if (!rows.length) rows.push(['Ciblage', 'Tout le monde']);
    return rows;
}

/** One campaign in full; when it waits for review, the decision is here. */
export function CampaignSheet({ campaign: c, onClose }: { campaign: AdsCampaign; onClose: () => void }) {
    const qc = useQueryClient();
    const [sheet, setSheet] = useState<'approve' | 'reject' | null>(null);
    const reviewable = c.status === 'paid' || c.status === 'pending_review';
    const live = ['active', 'paused', 'completed', 'banked'].includes(c.status);
    const perf = useQuery({ queryKey: ['ads', 'performance', c._id], queryFn: () => getAdsCampaignPerformance(c._id), enabled: live });
    const media = c.previewUrl || fileUrl(c.mediaFileId);
    const done = () => { qc.invalidateQueries({ queryKey: ['ads'] }); qc.invalidateQueries({ queryKey: ['queue', 'campaigns'] }); onClose(); };

    return (
        <Sheet open onClose={onClose} title={c.title} size="lg"
            footer={reviewable ? (
                <div className="grid grid-cols-2 gap-2">
                    <Button variant="secondary" onClick={() => setSheet('reject')}>Refuser…</Button>
                    <Button variant="success" onClick={() => setSheet('approve')}>Valider</Button>
                </div>
            ) : undefined}>
            <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={c.status} labels={CAMPAIGN_STATUS} />
                    {c.isFirstCampaign ? <Badge tone="warning">Première campagne de l’annonceur</Badge> : <Badge>{c.priorApprovedCampaigns} campagne(s) déjà validée(s)</Badge>}
                </div>
                {media && (c.mediaType === 'video'
                    ? <video src={media} controls playsInline className="w-full max-h-[50vh] rounded-tile bg-black" />
                    : <img src={media} alt="Créative" className="w-full max-h-[50vh] object-contain rounded-tile bg-surface-2" />)}
                {c.description && <p className="text-sm text-ink-2 whitespace-pre-line">{c.description}</p>}
                {c.suggestedCaption && <div><SectionTitle>Légende proposée</SectionTitle><p className="text-sm whitespace-pre-line">{c.suggestedCaption}</p></div>}

                <div>
                    <SectionTitle>Annonceur</SectionTitle>
                    {c.advertiser ? <MemberLink id={c.advertiser._id} name={c.advertiser.name} phone={c.advertiser.phoneNumber} avatar={c.advertiser.avatar} />
                        : <p className="text-sm text-ink-3">Introuvable pour le moment.</p>}
                    <KeyValue className="mt-2" items={[
                        c.contactWhatsapp ? ['WhatsApp', formatPhone(c.contactWhatsapp)] : null,
                        c.contactPhone ? ['Téléphone', formatPhone(c.contactPhone)] : null,
                        c.websiteUrl ? ['Site', <a href={c.websiteUrl} target="_blank" rel="noreferrer" className="text-primary break-all">{c.websiteUrl}</a>] : null,
                        c.landingPageUrl ? ['Page d’atterrissage', <a href={c.landingPageUrl} target="_blank" rel="noreferrer" className="text-primary break-all">Ouvrir</a>] : null,
                    ]} />
                </div>

                <div>
                    <SectionTitle>Ciblage et budget</SectionTitle>
                    <KeyValue items={[
                        ...targetingText(c),
                        ['Payé', formatMoney(c.amountPaid)],
                        ['Vues uniques visées', formatNumber(c.targetUniqueViews)],
                        ['Prix par vue unique', formatMoney(c.pricePerUniqueView)],
                        ['Diffuseurs qui correspondent', c.reach ? `${formatNumber(c.reach.matching)} sur ${formatNumber(c.reach.eligible)} actifs` : 'Inconnu'],
                        ['Vues atteignables', c.reach ? <span className={c.reach.sufficient === false ? 'text-danger' : ''}>{formatNumber(c.reach.projectedUniqueViews)}{c.reach.sufficient === false ? ' — moins que visé' : ''}</span> : 'Inconnu'],
                    ]} />
                </div>

                {live && (
                    <div>
                        <SectionTitle>Résultats</SectionTitle>
                        <KeyValue items={[
                            ['Vues uniques', `${formatNumber(c.progress.uniqueViewsDelivered)} / ${formatNumber(c.progress.targetUniqueViews)} (${Math.round(c.progress.percentComplete)} %)`],
                            ['Vues répétées', formatNumber(c.progress.repeatViewsDelivered)],
                            ['Clics', formatNumber(c.progress.clicksTotal)],
                        ]} />
                        {perf.isLoading ? <Spinner className="py-4" /> : perf.data?.diffuseurs.length ? (
                            <ul className="mt-3 divide-y divide-border border border-border rounded-tile">
                                {perf.data.diffuseurs.map(d => (
                                    <li key={d.diffuseurUserId} className="px-3 py-2.5 flex items-center gap-3">
                                        <div className="min-w-0 flex-1"><MemberLink id={d.diffuseurUserId} name={d.name} phone={d.phoneNumber} /></div>
                                        <div className="text-right text-sm shrink-0">
                                            <p className="font-semibold tabular">{formatNumber(d.uniqueViews)} vues · {formatNumber(d.clicks)} clics</p>
                                            <p className="text-ink-3 text-xs">{formatMoney(d.earned)} {d.paidAt ? 'payés' : 'à payer'}</p>
                                        </div>
                                        <StatusBadge status={d.status} labels={PARTICIPATION_STATUS} />
                                    </li>
                                ))}
                            </ul>
                        ) : <p className="mt-2 text-sm text-ink-3">Aucun diffuseur pour l’instant.</p>}
                    </div>
                )}

                <KeyValue items={[
                    ['Créée', formatDate(c.createdAt)],
                    c.submittedForReviewAt ? ['Envoyée en validation', formatDate(c.submittedForReviewAt)] : null,
                    c.activatedAt ? ['Lancée', formatDate(c.activatedAt)] : null,
                    c.completedAt ? ['Terminée', formatDate(c.completedAt)] : null,
                    c.rejectionReason ? ['Motif du refus', c.rejectionReason] : null,
                ]} />
            </div>

            <ConfirmSheet open={sheet === 'approve'} onClose={() => setSheet(null)} tone="success" title="Valider cette campagne ?"
                message={c.status === 'paid'
                    ? <p>Elle est déjà payée : elle démarre tout de suite, les diffuseurs reçoivent l’offre et l’annonceur est prévenu.</p>
                    : <p>Validée, elle attendra le paiement de l’annonceur, qui est prévenu.</p>}
                confirmLabel="Valider"
                onConfirm={async () => { await approveAdsCampaign(c._id); notify.success(c.status === 'paid' ? 'Campagne validée et lancée.' : 'Campagne validée.'); done(); }} />
            <ConfirmSheet open={sheet === 'reject'} onClose={() => setSheet(null)} tone="danger" title="Refuser cette campagne ?"
                message={<p>L’annonceur est prévenu avec le motif.{c.status === 'paid' ? ' Son paiement reste sur la campagne : il peut la corriger et la renvoyer sans repayer.' : ''}</p>}
                reason={{ label: 'Motif (visible par l’annonceur)', suggestions: REFUSE, minLength: 5 }}
                confirmLabel="Refuser"
                onConfirm={async (reason) => { await rejectAdsCampaign(c._id, reason); notify.success('Campagne refusée.'); done(); }} />
        </Sheet>
    );
}
