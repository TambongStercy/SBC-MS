import { useState, type ReactNode } from 'react';
import { ProfileStatus, type LoveProfile } from '../../services/adminSbcLoveApi';

const INTENTION_LABELS: Record<string, string> = {
    relation_serieuse: 'Relation sérieuse',
    faire_connaissance: 'Faire connaissance',
    projet_mariage: 'Projet de mariage',
    elargir_cercle_social: 'Élargir cercle social',
    echange_valeurs_respect: 'Échange valeurs & respect',
    autre: 'Autre',
};

// The two photos a profile must carry, in order (the member uploads them into
// named slots). Only the count is enforced server-side — telling a portrait from
// a full-body shot is exactly what this review is for.
const SLOT_LABELS = ['Portrait (visage)', 'Photo en pied (corps entier)'];

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
            <dd className="text-sm text-gray-200 mt-0.5">{children}</dd>
        </div>
    );
}

/**
 * The screen an admin actually validates on: the photos at a size where a face
 * is recognisable, the description in full, and who the SBC member is.
 */
export default function ProfileReviewModal({
    profile,
    onClose,
    onApprove,
    onReject,
    isBusy,
}: {
    profile: LoveProfile;
    onClose: () => void;
    onApprove: () => void;
    onReject: (reason: string) => void;
    isBusy?: boolean;
}) {
    const [rejecting, setRejecting] = useState(false);
    const [reason, setReason] = useState('');

    return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div
                className="bg-gray-800 rounded-lg w-full max-w-3xl max-h-[92vh] overflow-y-auto shadow-xl"
                onClick={e => e.stopPropagation()}
            >
                <div className="sticky top-0 bg-gray-800 border-b border-gray-700 px-6 py-4 flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-white">
                            {profile.displayName || profile.memberName || 'Profil SBC Love'}
                        </h3>
                        <p className="text-xs text-gray-400">
                            {profile.memberName}
                            {profile.memberEmail && ` · ${profile.memberEmail}`}
                            {profile.memberVerified === false && (
                                <span className="ml-2 text-red-400">email non vérifié</span>
                            )}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">×</button>
                </div>

                <div className="p-6 space-y-5">
                    {!profile.meetsPhotoRequirement && (
                        <p className="bg-yellow-900/40 border border-yellow-700 text-yellow-200 text-sm rounded px-3 py-2">
                            {profile.photoCount}/{profile.minPhotos} photo(s) — l'approbation sera refusée tant que le
                            minimum n'est pas atteint. Rejetez avec un motif pour que le membre complète son profil.
                        </p>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {profile.photos.length === 0 && (
                            <p className="text-sm text-gray-500 italic col-span-full">Aucune photo envoyée.</p>
                        )}
                        {profile.photos.map((photo, i) => (
                            <figure key={photo.fileId} className="bg-gray-900 rounded overflow-hidden">
                                {/* Opened in a new tab rather than a lightbox: an admin
                                    checking a face wants the full-resolution file. */}
                                <a href={photo.url} target="_blank" rel="noreferrer">
                                    <img
                                        src={photo.url}
                                        alt={SLOT_LABELS[i] ?? `Photo ${i + 1}`}
                                        className="w-full h-56 object-cover hover:opacity-90 transition-opacity"
                                    />
                                </a>
                                <figcaption className="text-xs text-gray-400 px-2 py-1.5">
                                    {SLOT_LABELS[i] ?? `Photo ${i + 1}`}
                                </figcaption>
                            </figure>
                        ))}
                    </div>

                    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <Field label="Sexe">{profile.sex ?? '—'}</Field>
                        <Field label="Âge">{profile.ageBracket ?? '—'}</Field>
                        <Field label="Ville">{[profile.city, profile.country].filter(Boolean).join(', ') || '—'}</Field>
                        <Field label="Membre depuis">
                            {profile.memberSince ? new Date(profile.memberSince).toLocaleDateString('fr-FR') : '—'}
                        </Field>
                        <Field label="Intention">
                            {profile.intention === 'autre' && profile.otherIntentionText
                                ? profile.otherIntentionText
                                : INTENTION_LABELS[profile.intention] ?? profile.intention}
                        </Field>
                        <Field label="Signalements">{profile.moderation.reportCount}</Field>
                        <Field label="Statut">{profile.status}</Field>
                        <Field label="Créé le">{new Date(profile.createdAt).toLocaleDateString('fr-FR')}</Field>
                    </dl>

                    <div>
                        <dt className="text-xs uppercase tracking-wide text-gray-500 mb-1">Description</dt>
                        <p className="text-sm text-gray-200 bg-gray-900 rounded p-3 whitespace-pre-line">
                            {profile.description || <span className="text-gray-500 italic">—</span>}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                            Interdits : numéros de téléphone, WhatsApp, réseaux sociaux, liens, emails.
                        </p>
                    </div>

                    {profile.moderation.rejectionReason && (
                        <Field label="Motif du dernier rejet">{profile.moderation.rejectionReason}</Field>
                    )}

                    {rejecting ? (
                        <div className="border-t border-gray-700 pt-4">
                            <label className="block text-sm text-gray-300 mb-1">Motif du rejet (envoyé au membre)</label>
                            <textarea
                                value={reason}
                                onChange={e => setReason(e.target.value)}
                                rows={3}
                                autoFocus
                                className="w-full bg-gray-700 text-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                                placeholder="Ex : la photo en pied manque, le visage n'est pas visible…"
                            />
                            <div className="flex justify-end gap-3 mt-3">
                                <button onClick={() => setRejecting(false)} className="px-4 py-2 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded">
                                    Retour
                                </button>
                                <button
                                    onClick={() => onReject(reason)}
                                    disabled={isBusy}
                                    className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded disabled:opacity-50"
                                >
                                    Confirmer le rejet
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex justify-end gap-3 border-t border-gray-700 pt-4">
                            <button onClick={onClose} className="px-4 py-2 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded">
                                Fermer
                            </button>
                            <button onClick={() => setRejecting(true)} className="px-4 py-2 text-sm bg-red-700 hover:bg-red-600 text-white rounded">
                                Rejeter
                            </button>
                            <button
                                onClick={onApprove}
                                disabled={isBusy || !profile.meetsPhotoRequirement || profile.status === ProfileStatus.APPROVED}
                                className="px-4 py-2 text-sm bg-green-700 hover:bg-green-600 text-white rounded disabled:opacity-40"
                                title={!profile.meetsPhotoRequirement ? `${profile.minPhotos} photos minimum` : undefined}
                            >
                                Approuver
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
