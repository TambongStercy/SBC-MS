import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Dialog, DialogContent, Field, Input } from '../ui';
import { onAdminCodeRequest, type AdminCodeAnswer } from '../../lib/adminCodePrompt';

type Pending = { error?: string; resolve: (a: AdminCodeAnswer | null) => void };

/**
 * Asks for the admin's authenticator code (or a backup code) before a money action
 * (lib/adminCodePrompt.ts). Mounted once at the app root.
 */
export default function AdminCodePrompt() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [useBackup, setUseBackup] = useState(false);
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => onAdminCodeRequest(p => { setPending(p); setValue(''); }), []);
  useEffect(() => { if (pending) setTimeout(() => input.current?.focus(), 50); }, [pending, useBackup]);

  const cancel = () => pending?.resolve(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!pending) return;
    const v = useBackup ? value.trim() : value.replace(/\s/g, '');
    if (useBackup ? v.length < 6 : !/^\d{6}$/.test(v)) return;
    pending.resolve(useBackup ? { adminBackupCode: v } : { adminCode: v });
  };

  return (
    <Dialog open={!!pending} onOpenChange={open => { if (!open) cancel(); }}>
      {pending && (
        <DialogContent
          size="sm"
          title="Confirmer avec votre code"
          footer={(
            <>
              <Button variant="outline" size="lg" onClick={cancel}>Annuler</Button>
              <Button variant="primary" size="lg" type="submit" form="admin-code-form">Confirmer</Button>
            </>
          )}
        >
          <form id="admin-code-form" onSubmit={submit} className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Cette opération envoie de l’argent. Entrez le code de votre application d’authentification :
              il reste valable 10 minutes pour vos autres opérations.
            </p>
            {pending.error && <p role="alert" className="text-sm text-danger">{pending.error}</p>}
            <Field label={useBackup ? 'Code de secours' : 'Code à 6 chiffres'}>
              <Input
                ref={input}
                value={value}
                onChange={e => setValue(e.target.value)}
                inputMode={useBackup ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                maxLength={useBackup ? 20 : 7}
                placeholder={useBackup ? 'xxxx-xxxx' : '123 456'}
                aria-label={useBackup ? 'Code de secours' : 'Code à 6 chiffres'}
              />
            </Field>
            <button type="button" className="self-start text-sm text-primary underline" onClick={() => { setUseBackup(b => !b); setValue(''); }}>
              {useBackup ? 'Utiliser le code de l’application' : 'Utiliser un code de secours'}
            </button>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
