import { useState } from 'react';
import type { ExportKind } from '../../api/animation';
import { useChallengeIndex } from './shared';
import { Card, ExportButtons, selectCls } from './ui';

const ALL: ExportKind[] = ['leaderboard', 'results', 'winners', 'transactions', 'votes', 'candidates', 'audit'];

/**
 * Every animation export in one place, scoped to an event or a challenge (or
 * everything). The same exports are offered in context: challenge detail,
 * « Votes payants » and « Journal ».
 */
export default function ExportsTab() {
    const { challenges, events } = useChallengeIndex();
    const [eventId, setEventId] = useState('');
    const [challengeId, setChallengeId] = useState('');
    const pickable = eventId ? challenges.filter(c => c.eventId === eventId) : challenges;
    // The live leaderboard exists per challenge only (export.service refuses it without one).
    const kinds = challengeId ? ALL : ALL.filter(k => k !== 'leaderboard');

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
                <select value={eventId} onChange={e => { setEventId(e.target.value); setChallengeId(''); }} className={`${selectCls} max-w-xs`}>
                    <option value="">Tous les événements</option>
                    {events.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
                </select>
                <select value={challengeId} onChange={e => setChallengeId(e.target.value)} className={`${selectCls} max-w-xs`}>
                    <option value="">Tous les défis</option>
                    {pickable.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                </select>
            </div>
            <Card>
                <p className="text-xs text-fg-muted mb-2">
                    {challengeId ? 'Exports du défi choisi.' : eventId ? 'Exports de l’événement choisi.' : 'Exports de tout le module.'}
                    {!challengeId && ' Le classement en direct demande de choisir un défi.'}
                </p>
                <ExportButtons kinds={kinds} scope={{ eventId: eventId || undefined, challengeId: challengeId || undefined }} />
            </Card>
        </div>
    );
}
