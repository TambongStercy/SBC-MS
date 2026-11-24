import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Segmented } from '../ui';
import type { Edition } from '../../services/impactV2Api';
import AnomaliesPanel from './AnomaliesPanel';
import FreeVotesPanel from './FreeVotesPanel';
import PurchasesPanel from './PurchasesPanel';
import { useCandidateIndex } from './candidateIndex';

type View = 'paid' | 'free' | 'anomalies';

/**
 * Paid purchases, free votes, anomalies. `?achats=incertains` (the to-do link)
 * opens the purchases filtered on uncertain refunds.
 */
export default function VotesTab({ edition, canWrite, onChanged }: { edition: Edition; canWrite: boolean; onChanged: () => void }) {
    const [params] = useSearchParams();
    const uncertain = params.get('achats') === 'incertains';
    const [view, setView] = useState<View>(uncertain || edition.stage !== 'WEEK2' ? 'paid' : 'free');
    // Only the candidate filters need the list of candidates (the answers carry the names).
    const index = useCandidateIndex(edition._id, view !== 'anomalies');
    return (
        <div className="space-y-4">
            <Segmented<View>
                label="Votes"
                value={view}
                onValueChange={setView}
                options={[
                    { value: 'paid', label: 'Votes payants' },
                    { value: 'free', label: 'Vote gratuit' },
                    { value: 'anomalies', label: 'Anomalies' },
                ]}
            />
            {view === 'paid' && (
                <PurchasesPanel
                    key={uncertain ? 'uncertain' : 'all'}
                    editionId={edition._id}
                    index={index.data}
                    canRefund={canWrite && !edition.top3?.decidedAt}
                    onChanged={onChanged}
                    initialSignal={uncertain ? 'uncertain' : ''}
                />
            )}
            {view === 'free' && <FreeVotesPanel editionId={edition._id} index={index.data} />}
            {view === 'anomalies' && <AnomaliesPanel editionId={edition._id} />}
        </div>
    );
}
