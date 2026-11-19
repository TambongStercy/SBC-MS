import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { authApi } from '../../api/auth';
import { errorMessage } from '../../api/http';
import { Button, Field, Input } from '../../components/ui';
import { AuthLayout, FormError } from './AuthLayout';

export const MIN_PASSWORD = 12;

/** Activation link from an admin: the agent chooses a password (once). */
export default function ActivatePage() {
  const [params, setParams] = useSearchParams();
  // Read the token once, then take it out of the address bar (and history).
  // The service sends `/activate#<token>` (a fragment never reaches a server log
  // or a Referer header); `?token=` is still accepted.
  const [token] = useState(() => {
    const fromHash = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '';
    return fromHash || params.get('token') || '';
  });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search);
    if (params.has('token')) setParams({}, { replace: true });
  }, [params, setParams]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < MIN_PASSWORD) { setError(`Le mot de passe doit faire au moins ${MIN_PASSWORD} caractères.`); return; }
    if (password !== confirm) { setError('Les deux mots de passe ne sont pas identiques.'); return; }
    setBusy(true);
    try {
      await authApi.activate(token, password);
      setDone(true);
    } catch (err) {
      setError(errorMessage(err, 'Lien invalide ou expiré. Demandez un nouveau lien à l’administrateur.'));
    } finally {
      setBusy(false);
      setPassword('');
      setConfirm('');
    }
  };

  if (!token && !done) {
    return (
      <AuthLayout subtitle="Activation du compte">
        <p className="text-sm text-fg-muted">Ce lien d’activation est incomplet. Ouvrez le lien reçu de l’administrateur du support, sans le modifier.</p>
        <Button asChild variant="outline" className="mt-4 w-full"><Link to="/connexion">Aller à la connexion</Link></Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout subtitle="Activation du compte">
      {done ? (
        <div className="flex flex-col gap-4" role="status">
          <p className="text-sm text-fg">Votre compte est activé. Connectez-vous : vous configurerez ensuite votre application d’authentification.</p>
          <Button asChild variant="primary" size="lg" className="w-full"><Link to="/connexion">Se connecter</Link></Button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Choisir un mot de passe">
          <p className="text-sm text-fg-muted">
            Choisissez votre mot de passe : au moins {MIN_PASSWORD} caractères. Une phrase de plusieurs mots est plus sûre et plus facile à retenir. Les mots de passe connus pour avoir fuité sont refusés.
          </p>
          <FormError message={error} />
          <Field label="Nouveau mot de passe" help={`${password.length} / ${MIN_PASSWORD} caractères minimum`}>
            <Input type="password" autoComplete="new-password" className="h-11 text-base md:text-sm" value={password} onChange={e => setPassword(e.target.value)} disabled={busy} />
          </Field>
          <Field label="Confirmer le mot de passe">
            <Input type="password" autoComplete="new-password" className="h-11 text-base md:text-sm" value={confirm} onChange={e => setConfirm(e.target.value)} disabled={busy} />
          </Field>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>Activer mon compte</Button>
        </form>
      )}
    </AuthLayout>
  );
}
