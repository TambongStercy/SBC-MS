import { useEffect, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { CancelCircleIcon, CheckmarkCircle02Icon, Image01Icon } from '@hugeicons/core-free-icons';
import { ProfileStatus, type LoveProfile } from '../../services/adminSbcLoveApi';
import { Badge, Button, Dialog, Field, SheetContent, Textarea } from '../ui';
import { Can } from '../Can';
import { DetailList, Notice, SheetSection, StatusBadge, formatDate } from '../moduleKit';
import { PROFILE_STATUS, REJECTION_REASON_NOTE, SEX_LABELS, SLOT_LABELS, intentionLabel } from './labels';

/**
 * The sheet an admin validates on: the photos at a size where a face is
 * recognisable, the description in full, and who the SBC member is.
 * Approve / reject sit in the footer (write access only).
 */
export default function ProfileReviewSheet({ profile, onClose, onApprove, onReject, isBusy }: {
  profile: LoveProfile | null;
  onClose: () => void;
  onApprove: (profile: LoveProfile) => void;
  onReject: (profile: LoveProfile, reason: string) => void;
  isBusy?: boolean;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  useEffect(() => { setRejecting(false); setReason(''); }, [profile?._id]);

  const p = profile;
  const canApprove = !!p && p.meetsPhotoRequirement && p.status !== ProfileStatus.APPROVED;

  return (
    <Dialog open={!!p} onOpenChange={o => { if (!o && !isBusy) onClose(); }}>
      {p && (
        <SheetContent
          width="xl"
          title={p.displayName || p.memberName || 'Profil SBC Love'}
          description={(
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{[p.memberName, p.memberEmail].filter(Boolean).join(' · ') || p.userId}</span>
              {p.memberVerified === false && <Badge tone="danger">E-mail non vérifié</Badge>}
            </span>
          )}
          footer={(
            <Can module="sbclove" write fallback={<Button variant="outline" size="lg" onClick={onClose}>Fermer</Button>}>
              {rejecting ? (
                <>
                  <Button variant="outline" size="lg" onClick={() => setRejecting(false)} disabled={isBusy}>Retour</Button>
                  <Button variant="danger" size="lg" loading={isBusy} onClick={() => onReject(p, reason.trim())}>Confirmer le refus</Button>
                </>
              ) : (
                <>
                  <Button variant="outline" size="lg" onClick={onClose}>Fermer</Button>
                  <Button variant="danger-ghost" size="lg" onClick={() => setRejecting(true)}>
                    <HugeiconsIcon icon={CancelCircleIcon} size={16} aria-hidden="true" />
                    Refuser
                  </Button>
                  <Button variant="primary" size="lg" loading={isBusy} disabled={!canApprove} onClick={() => onApprove(p)}
                    title={!p.meetsPhotoRequirement ? `${p.minPhotos} photos minimum` : undefined}>
                    <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} aria-hidden="true" />
                    Approuver
                  </Button>
                </>
              )}
            </Can>
          )}
        >
          <div className="space-y-6">
            {!p.meetsPhotoRequirement && (
              <Notice tone="warning">
                {p.photoCount}/{p.minPhotos} photo{p.photoCount > 1 ? 's' : ''} : l’approbation sera refusée tant que le minimum n’est pas atteint.
                Refusez le profil pour que le membre le complète.
              </Notice>
            )}

            <SheetSection title="Photos">
              {p.photos.length === 0 ? (
                <div className="flex items-center gap-2 rounded-panel border border-dashed border-line px-4 py-6 text-sm text-fg-muted">
                  <HugeiconsIcon icon={Image01Icon} size={18} aria-hidden="true" />
                  Aucune photo envoyée.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {p.photos.map((photo, i) => (
                    <figure key={photo.fileId} className="overflow-hidden rounded-panel border border-line bg-surface-2">
                      {/* A new tab, not a lightbox: checking a face wants the full-resolution file. */}
                      <a href={photo.url} target="_blank" rel="noreferrer" className="block">
                        <img src={photo.url} alt={SLOT_LABELS[i] ?? `Photo ${i + 1}`} className="h-48 w-full object-cover sm:h-56" />
                      </a>
                      <figcaption className="px-2 py-1.5 text-xs text-fg-muted">{SLOT_LABELS[i] ?? `Photo ${i + 1}`}</figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </SheetSection>

            <SheetSection title="Description">
              <p className="whitespace-pre-line rounded-panel border border-line bg-surface-2 p-3 text-sm text-fg">
                {p.description || <span className="text-fg-subtle">Pas de description.</span>}
              </p>
              <p className="text-xs text-fg-muted">Interdits : numéros de téléphone, WhatsApp, réseaux sociaux, liens, e-mails.</p>
            </SheetSection>

            <SheetSection title="Profil">
              <DetailList items={[
                ['Statut', <StatusBadge status={p.status} map={PROFILE_STATUS} />],
                ['Intention', intentionLabel(p.intention, p.otherIntentionText)],
                ['Sexe', p.sex ? SEX_LABELS[p.sex] ?? p.sex : '—'],
                ['Âge', p.ageBracket ?? '—'],
                ['Ville', [p.city, p.country].filter(Boolean).join(', ') || '—'],
                ['Signalements', <span className="tabular-nums">{p.moderation.reportCount}</span>],
                ['Profil créé le', formatDate(p.createdAt)],
                ['Membre SBC depuis', formatDate(p.memberSince)],
                !!p.moderation.validatedAt && ['Dernière décision', formatDate(p.moderation.validatedAt)],
                !!p.moderation.rejectionReason && ['Motif du dernier refus', p.moderation.rejectionReason],
              ]} />
            </SheetSection>

            {rejecting && (
              <SheetSection title="Refuser le profil">
                <Field label="Motif du refus (facultatif)" help={REJECTION_REASON_NOTE}>
                  <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} autoFocus
                    placeholder="Ex. : la photo en pied manque, le visage n’est pas visible…" />
                </Field>
              </SheetSection>
            )}
          </div>
        </SheetContent>
      )}
    </Dialog>
  );
}
