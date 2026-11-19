import { RefreshIcon } from '@hugeicons/core-free-icons';
import { errorMessage } from '../../api/http';
import { Button, EmptyState } from '../ui';

/** A list or panel that failed to load, with "Réessayer". */
export function ErrorState({ title = 'Le chargement a échoué', error, onRetry, retrying, className }: {
  title?: string;
  error?: unknown;
  onRetry: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <EmptyState
      icon={RefreshIcon}
      title={title}
      description={errorMessage(error, 'Vérifiez la connexion, puis réessayez.')}
      action={<Button onClick={onRetry} loading={retrying}>Réessayer</Button>}
      className={className}
    />
  );
}
