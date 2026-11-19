import { createContext, useCallback, useContext, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { authApi } from '../api/auth';
import { errorMessage } from '../api/http';
import { Button, Dialog, DialogContent, Field, Input } from '../components/ui';

/** Thrown when the agent closes the confirmation without a code. */
export class ReauthCancelled extends Error {
  constructor() { super('reauth cancelled'); this.name = 'ReauthCancelled'; }
}

export interface ReauthRequest {
  /** What is being confirmed ("Valider la régularisation"). */
  title?: string;
  description?: string;
}

type Ask = (req?: ReauthRequest) => Promise<string>;
const ReauthContext = createContext<Ask | null>(null);

/**
 * Sensitive actions ask for a fresh code from the authenticator app just
 * before they run (CONTRACT §3.1: POST /auth/reauth → reauthToken, valid
 * 5 min, single use, sent as x-reauth-token). Usage:
 *
 *   const reauth = useReauth();
 *   const token = await reauth({ title: 'Valider la demande' });
 *   await approvalsApi.approve(id, note, token);
 *
 * The token lives only in the caller's closure for that one call.
 */
export function useReauth(): Ask {
  const ctx = useContext(ReauthContext);
  if (!ctx) throw new Error('useReauth outside ReauthProvider');
  return ctx;
}

export const isReauthCancelled = (e: unknown) => e instanceof ReauthCancelled;

export function ReauthProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ReauthRequest | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ resolve: (t: string) => void; reject: (e: Error) => void } | null>(null);

  const ask = useCallback<Ask>((req = {}) => {
    pending.current?.reject(new ReauthCancelled());
    setRequest(req);
    setCode('');
    setError('');
    return new Promise<string>((resolve, reject) => { pending.current = { resolve, reject }; });
  }, []);

  const close = () => {
    pending.current?.reject(new ReauthCancelled());
    pending.current = null;
    setRequest(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const clean = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(clean)) { setError('Entrez les 6 chiffres de votre application.'); return; }
    setBusy(true);
    setError('');
    try {
      const { reauthToken } = await authApi.reauth(clean);
      pending.current?.resolve(reauthToken);
      pending.current = null;
      setRequest(null);
    } catch (err) {
      setError(errorMessage(err, 'Code refusé. Réessayez.'));
    } finally {
      setBusy(false);
      setCode('');
    }
  };

  const value = useMemo(() => ask, [ask]);
  return (
    <ReauthContext.Provider value={value}>
      {children}
      <Dialog open={!!request} onOpenChange={o => { if (!o) close(); }}>
        {request && (
          <DialogContent
            size="sm"
            title={request.title ?? 'Confirmez avec votre code'}
            description={request.description ?? 'Action sensible : entrez le code à 6 chiffres affiché par votre application d’authentification.'}
          >
            <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Confirmation par code">
              <Field label="Code de l’application" error={error || undefined}>
                <Input
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  placeholder="123456"
                  className="h-11 font-mono text-base tracking-[0.3em]"
                  value={code}
                  onChange={e => setCode(e.target.value)}
                />
              </Field>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="ghost" onClick={close}>Annuler</Button>
                <Button type="submit" variant="primary" loading={busy}>Confirmer</Button>
              </div>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </ReauthContext.Provider>
  );
}
