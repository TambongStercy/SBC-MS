import { RefreshIcon } from '@hugeicons/core-free-icons';
import { Button, EmptyState } from '../ui';

/** A list or panel that failed to load, with "Réessayer". */
export function ErrorState({ title = 'Le chargement a échoué', message, onRetry, retrying, className }: {
    title?: string;
    message?: string;
    onRetry: () => void;
    retrying?: boolean;
    className?: string;
}) {
    return (
        <EmptyState
            icon={RefreshIcon}
            title={title}
            description={message ?? 'Vérifiez la connexion, puis réessayez.'}
            action={<Button size="lg" onClick={onRetry} loading={retrying}>Réessayer</Button>}
            className={className}
        />
    );
}
