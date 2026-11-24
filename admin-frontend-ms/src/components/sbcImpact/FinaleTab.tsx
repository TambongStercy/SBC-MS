import type { Edition } from '../../services/impactV2Api';
import JuryPanel from './JuryPanel';
import LivePanel from './LivePanel';
import MarksPanel from './MarksPanel';
import ResultPanel from './ResultPanel';
import ShowcaseBlock from './ShowcaseBlock';

/**
 * The live final (spec §10–§12): the live control and the final vote, the jury,
 * its marks and their lock, and the result. TOP3 = preparing (jury, start);
 * LIVE = on stage, marks, lock, result; RESULT = everything frozen, and the
 * finalists' « SBC Impact » pages.
 */
export default function FinaleTab({ edition, canWrite, onChanged, onEdition }: {
    edition: Edition;
    canWrite: boolean;
    onChanged: (e?: Edition) => void;
    onEdition: (e: Edition) => void;
}) {
    const started = edition.stage === 'LIVE' || edition.stage === 'RESULT';
    return (
        <div className="space-y-4">
            <LivePanel edition={edition} canWrite={canWrite} onChanged={onChanged} onEdition={onEdition} />
            <JuryPanel edition={edition} canWrite={canWrite} onChanged={() => onChanged()} />
            {started && <MarksPanel edition={edition} canWrite={canWrite} onChanged={onChanged} />}
            {started && <ResultPanel edition={edition} canWrite={canWrite} onChanged={onChanged} />}
            {(edition.stage === 'RESULT' || !!edition.result?.publishedAt) && <ShowcaseBlock edition={edition} canWrite={canWrite} onChanged={() => onChanged()} />}
        </div>
    );
}
