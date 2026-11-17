import { useState } from 'react';
import type { ExportKind } from '../../api/animation';
import { Panel, PanelBody, PanelHeader } from '../ui';
import { FilterBar, FilterSelect } from '../moduleKit';
import { useChallengeIndex } from './shared';
import { ExportButtons } from './ui';

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
        <Panel>
            <div className="border-b border-line p-4">
                <FilterBar
                    filterCount={2}
                    activeCount={(eventId ? 1 : 0) + (challengeId ? 1 : 0)}
                    onClear={() => { setEventId(''); setChallengeId(''); }}
                    filters={(
                        <>
                            <FilterSelect label="Événement" allLabel="Tous les événements" value={eventId} onChange={v => { setEventId(v); setChallengeId(''); }}
                                options={events.map(e => ({ value: e.id, label: e.title }))} />
                            <FilterSelect label="Défi" allLabel="Tous les défis" value={challengeId} onChange={setChallengeId}
                                options={pickable.map(c => ({ value: c._id, label: c.name }))} />
                        </>
                    )}
                />
            </div>
            <PanelHeader
                title={challengeId ? 'Exports du défi choisi' : eventId ? 'Exports de l’événement choisi' : 'Exports de tout le module'}
                description={challengeId ? undefined : 'Le classement en direct demande de choisir un défi.'}
            />
            <PanelBody>
                <ExportButtons kinds={kinds} scope={{ eventId: eventId || undefined, challengeId: challengeId || undefined }} />
            </PanelBody>
        </Panel>
    );
}
