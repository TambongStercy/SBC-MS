import { Tooltip } from '../ui';
import { fmtDateTime, fmtRelative } from './format';

/** A date shown relative when recent ("il y a 2 h"), the full date in a tooltip. */
export function RelativeDate({ value, className }: { value: string | number | Date | null | undefined; className?: string }) {
    if (value === null || value === undefined || value === '') return <span className={className}>—</span>;
    const full = fmtDateTime(value);
    return (
        <Tooltip content={full}>
            <time
                dateTime={new Date(value).toISOString()}
                className={className}
                tabIndex={0}
                aria-label={full}
            >
                {fmtRelative(value)}
            </time>
        </Tooltip>
    );
}
