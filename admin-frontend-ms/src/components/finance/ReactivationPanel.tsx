import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Badge, Button, Dialog, DialogContent, Field, Input, Panel, PanelBody, PanelHeader, Skeleton, Table, TBody, TD, Textarea, TH, THead, TR,
} from '../ui';
import { formatDateTime, formatNumber } from '../common/format';
import { usePermission } from '../../hooks/usePermission';
import {
  approveReactivationText, cancelReactivationCampaign, DormantFilters, getReactivationText, listReactivationCampaigns, previewReactivation,
  ReactivationCampaign, ReactivationExclusion, ReactivationPreview, ReactivationText, ReactivationTextState, saveReactivationDraft,
  startReactivationCampaign,
} from '../../services/adminDormantApi';

/**
 * Comptes dormants → « Message de réactivation » (Security plan Phase 7 part 2).
 * A super admin writes the text and approves it; only the approved version is ever sent.
 * Finance (write) previews who the current filters reach, then sends (the admin's own code is
 * asked), at most once per member per 30 days. History with sent / failed / come back.
 */

const EXCLUSION_LABEL: Record<ReactivationExclusion, string> = {
  inactive: 'compte supprimé ou bloqué',
  frozen: 'compte gelé',
  fraud: 'signalé par l’anti-fraude',
  recent_contact: 'déjà contacté il y a moins de 30 jours',
  unreachable: 'ni e-mail utilisable ni notification',
  test_mode: 'hors liste de test (mode test)',
  returned: 'revenu entre-temps',
  cancelled: 'campagne annulée',
  send_failed: 'échec d’envoi',
};
const STATUS: Record<ReactivationCampaign['status'], { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }> = {
  building: { label: 'Préparation', tone: 'info' },
  sending: { label: 'Envoi en cours', tone: 'info' },
  done: { label: 'Terminée', tone: 'success' },
  cancelled: { label: 'Annulée', tone: 'warning' },
  failed: { label: 'Échec', tone: 'danger' },
};
const FIELDS: { key: keyof ReactivationText; label: string; rows?: number; max: number }[] = [
  { key: 'subject', label: 'Objet de l’e-mail', max: 120 },
  { key: 'body', label: 'Message (paragraphes séparés par une ligne vide)', rows: 9, max: 2000 },
  { key: 'pushTitle', label: 'Titre de la notification', max: 80 },
  { key: 'pushBody', label: 'Texte de la notification', rows: 2, max: 200 },
];
const apiMessage = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
const exclusions = (e: Partial<Record<ReactivationExclusion, number>>) =>
  (Object.entries(e) as [ReactivationExclusion, number][]).filter(([, n]) => n > 0).map(([k, n]) => `${formatNumber(n)} ${EXCLUSION_LABEL[k] ?? k}`).join(' · ');

type Confirm = { title: string; message: string; confirm: string; danger?: boolean; run: () => Promise<void> } | null;

const ReactivationPanel: React.FC<{ filters: DormantFilters }> = ({ filters }) => {
  const superAdmin = usePermission('staff') === 'write';
  const canSend = usePermission('finance') === 'write';
  const [text, setText] = useState<ReactivationTextState | null>(null);
  const [draft, setDraft] = useState<ReactivationText | null>(null);
  const [campaigns, setCampaigns] = useState<ReactivationCampaign[] | null>(null);
  const [preview, setPreview] = useState<ReactivationPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);

  const loadText = () => getReactivationText().then(t => { setText(t); setDraft({ subject: t.draft.subject, body: t.draft.body, pushTitle: t.draft.pushTitle, pushBody: t.draft.pushBody }); })
    .catch(() => toast.error('Le message de réactivation n’a pas pu être chargé.'));
  const loadCampaigns = () => listReactivationCampaigns().then(setCampaigns).catch(() => setCampaigns([]));
  useEffect(() => { void loadText(); void loadCampaigns(); }, []);
  useEffect(() => { setPreview(null); }, [filters]);
  const running = campaigns?.some(c => c.status === 'building' || c.status === 'sending') ?? false;
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => { void loadCampaigns(); }, 15_000);
    return () => window.clearInterval(t);
  }, [running]);

  const dirty = !!text && !!draft && (Object.keys(draft) as (keyof ReactivationText)[]).some(k => draft[k] !== text.draft[k]);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try { const t = await saveReactivationDraft(draft); setText(t); toast.success('Brouillon enregistré. Il faut l’approuver avant tout envoi.'); }
    catch (err) { toast.error(apiMessage(err, 'Le brouillon n’a pas pu être enregistré.')); }
    finally { setBusy(false); }
  };
  const approve = () => setConfirm({
    title: 'Approuver ce message',
    message: 'Les prochains envois utiliseront exactement ce texte. Les campagnes déjà lancées gardent le leur.',
    confirm: 'Approuver',
    run: async () => { const t = await approveReactivationText(); setText(t); toast.success(`Version ${t.approved?.version} approuvée.`); },
  });
  const runPreview = async () => {
    setBusy(true);
    try { setPreview(await previewReactivation(filters)); }
    catch (err) { toast.error(apiMessage(err, 'L’aperçu n’a pas pu être calculé.')); }
    finally { setBusy(false); }
  };
  const send = () => preview && setConfirm({
    title: 'Envoyer le message de réactivation',
    message: `${formatNumber(preview.sendable)} membre(s) recevront la version ${preview.approvedVersion} par e-mail et/ou notification, dans la journée (07:00–19:00), au rythme que le serveur d’e-mails permet. Chaque membre ne peut être contacté qu’une fois par ${preview.minDays} jours. Votre code d’authentification vous sera demandé.`,
    confirm: 'Envoyer',
    run: async () => {
      const r = await startReactivationCampaign(filters);
      toast.success(r.mode === 'live' ? 'Campagne lancée.' : 'Campagne lancée en mode test : seuls les membres de la liste de test reçoivent le message.');
      setPreview(null);
      await loadCampaigns();
    },
  });
  const cancel = (c: ReactivationCampaign) => setConfirm({
    title: 'Annuler la campagne',
    message: `Les ${formatNumber(c.pending)} membre(s) pas encore contactés ne recevront rien (ils redeviennent contactables). Les envois déjà faits restent.`,
    confirm: 'Annuler la campagne', danger: true,
    run: async () => { const r = await cancelReactivationCampaign(c.id); toast.success(`Campagne annulée (${formatNumber(r.notSent)} non envoyés).`); await loadCampaigns(); },
  });
  const doConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try { await confirm.run(); setConfirm(null); }
    catch (err) { toast.error(apiMessage(err, 'L’action a échoué.')); }
    finally { setBusy(false); }
  };

  const approved = text?.approved;
  return (
    <Panel>
      <PanelHeader
        title="Message de réactivation"
        description="Un e-mail et une notification aux comptes dormants de la liste ci-dessus (mêmes filtres), au plus une fois par membre tous les 30 jours. Un membre qui revient passe toujours par la retenue de retour."
      />
      <PanelBody className="space-y-4">
        {!text || !draft ? <Skeleton className="h-24 w-full" /> : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {approved
                ? <Badge tone="success">Version {approved.version} approuvée le {formatDateTime(approved.approvedAt)}</Badge>
                : <Badge tone="warning">Aucun texte approuvé : rien ne peut être envoyé</Badge>}
              {approved && !text.draftApproved && <Badge tone="info">Le brouillon diffère de la version approuvée</Badge>}
            </div>
            {superAdmin ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {FIELDS.map(f => (
                  <Field key={f.key} label={f.label} className={f.key === 'body' ? 'lg:row-span-3' : undefined}>
                    {f.rows
                      ? <Textarea rows={f.rows} maxLength={f.max} value={draft[f.key]} onChange={e => setDraft({ ...draft, [f.key]: e.target.value })} />
                      : <Input maxLength={f.max} value={draft[f.key]} onChange={e => setDraft({ ...draft, [f.key]: e.target.value })} />}
                  </Field>
                ))}
              </div>
            ) : (
              <div className="rounded-control border border-line bg-surface-2 p-3 text-sm">
                <p className="font-medium">{(approved ?? text.draft).subject}</p>
                <p className="mt-2 whitespace-pre-line text-fg-muted">{(approved ?? text.draft).body}</p>
              </div>
            )}
            <p className="text-xs text-fg-muted">
              Texte seul, sans lien : l’e-mail ajoute un bouton « Ouvrir SBC » vers l’accueil de l’application, le rappel « SBC ne vous demandera jamais votre mot de passe ni vos codes » et un lien de désabonnement. « {'{{nom}}'} » est remplacé par le prénom.
            </p>
            {superAdmin && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" disabled={busy || !dirty} onClick={() => void save()}>Enregistrer le brouillon</Button>
                <Button size="sm" disabled={busy || dirty || text.draftApproved} onClick={approve}>Approuver ce texte</Button>
                {dirty && <span className="self-center text-xs text-fg-muted">Enregistrez avant d’approuver.</span>}
              </div>
            )}
          </div>
        )}

        {canSend && (
          <div className="space-y-2 border-t border-line pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void runPreview()}>Qui recevrait le message ?</Button>
              {preview && (
                <Button size="sm" disabled={busy || running || !preview.sendable || !preview.approvedVersion} onClick={send}>
                  Envoyer à {formatNumber(preview.sendable)} membre(s)
                </Button>
              )}
              {running && <span className="text-xs text-fg-muted">Une campagne est en cours : une seule à la fois.</span>}
            </div>
            {preview && (
              <div className="rounded-control border border-line bg-surface-2 px-3 py-2 text-sm" aria-label="Aperçu de l’envoi">
                <p>
                  <strong>{formatNumber(preview.sendable)}</strong> sur {formatNumber(preview.matched)} compte(s) de la liste
                  {preview.reachKnown && <> · {formatNumber(preview.withEmail)} par e-mail · {formatNumber(preview.withPush)} par notification</>}
                </p>
                {exclusions(preview.excluded) && <p className="mt-1 text-fg-muted">Laissés de côté : {exclusions(preview.excluded)}.</p>}
                {!preview.reachKnown && <p className="mt-1 text-warning">Le service de notifications ne répond pas : les adresses désabonnées seront écartées au moment de l’envoi.</p>}
                {preview.mode === 'allowlist' && <p className="mt-1 text-warning">Mode test : seuls les membres de la liste de test reçoivent le message (REACTIVATION_SEND_MODE n’est pas « live »).</p>}
                {!preview.approvedVersion && <p className="mt-1 text-danger">Aucun texte approuvé.</p>}
                {preview.capped && <p className="mt-1 text-warning">Liste limitée aux 200 000 plus gros comptes : affinez les filtres.</p>}
              </div>
            )}
          </div>
        )}

        <div className="space-y-2 border-t border-line pt-3">
          <h3 className="text-sm font-medium">Campagnes</h3>
          {!campaigns ? <Skeleton className="h-8 w-full" /> : campaigns.length === 0 ? <p className="text-sm text-fg-muted">Aucune campagne pour l’instant.</p> : (
            <div className="overflow-x-auto">
              <Table>
                <THead><TR><TH>Lancée</TH><TH>Statut</TH><TH>Texte</TH><TH numeric>Membres</TH><TH numeric>Envoyés</TH><TH numeric>Échecs</TH><TH numeric>Écartés</TH><TH numeric>Revenus (30 j)</TH>{canSend && <TH />}</TR></THead>
                <TBody>
                  {campaigns.map(c => (
                    <TR key={c.id}>
                      <TD className="whitespace-nowrap">{formatDateTime(c.createdAt)}{c.mode === 'allowlist' && <div className="text-xs text-warning">mode test</div>}</TD>
                      <TD>
                        <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
                        {c.status === 'sending' && <div className="mt-1 text-xs text-fg-muted">{formatNumber(c.pending)} en attente{c.waitUntil ? ` · reprise ${formatDateTime(c.waitUntil)}` : ''}</div>}
                        {c.error && <div className="mt-1 text-xs text-danger">{c.error}</div>}
                      </TD>
                      <TD>{c.textVersion ? `v${c.textVersion}` : '—'}</TD>
                      <TD numeric>{formatNumber(c.counts.targets)}</TD>
                      <TD numeric>{formatNumber(c.counts.sent)}<div className="text-xs text-fg-muted">{formatNumber(c.counts.emailSent)} e-mail · {formatNumber(c.counts.pushSent)} notif.</div></TD>
                      <TD numeric>{formatNumber(c.counts.failed)}</TD>
                      <TD numeric title={exclusions(c.excluded)}>{formatNumber(c.counts.skipped)}</TD>
                      <TD numeric>{formatNumber(c.counts.returned)}{c.counts.sent > 0 && <div className="text-xs text-fg-muted">{Math.round((c.counts.returned / c.counts.sent) * 1000) / 10} %</div>}</TD>
                      {canSend && <TD>{(c.status === 'building' || c.status === 'sending') && <Button size="sm" variant="ghost" onClick={() => cancel(c)}>Annuler</Button>}</TD>}
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </div>
      </PanelBody>

      {confirm && (
        <Dialog open onOpenChange={o => { if (!o && !busy) setConfirm(null); }}>
          <DialogContent
            title={confirm.title}
            description={confirm.message}
            footer={<>
              <Button variant="ghost" onClick={() => setConfirm(null)} disabled={busy}>Retour</Button>
              <Button variant={confirm.danger ? 'danger' : 'primary'} onClick={() => void doConfirm()} disabled={busy}>{confirm.confirm}</Button>
            </>}
          />
        </Dialog>
      )}
    </Panel>
  );
};

export default ReactivationPanel;
