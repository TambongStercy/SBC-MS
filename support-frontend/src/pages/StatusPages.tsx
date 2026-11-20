import { Link } from 'react-router-dom';
import { LockIcon, SearchRemoveIcon } from '@hugeicons/core-free-icons';
import { Button, EmptyState } from '../components/ui';

export function ForbiddenPage() {
  return (
    <EmptyState icon={LockIcon} title="Accès refusé"
      description="Votre rôle ne donne pas accès à cet écran. Si vous en avez besoin, demandez à l’administrateur du support."
      action={<Button asChild><Link to="/">Retour à l’accueil</Link></Button>} />
  );
}

export function NotFoundPage() {
  return (
    <EmptyState icon={SearchRemoveIcon} title="Page introuvable" description="Ce lien ne mène à aucun écran."
      action={<Button asChild><Link to="/">Retour à l’accueil</Link></Button>} />
  );
}
