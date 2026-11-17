import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { errorMessage } from '../api/http';
import { isReauthCancelled } from '../auth/reauth';
import { Button, Dialog, DialogContent, Field, Textarea } from './ui';

/**
 * A confirmation that needs a written reason (rejections, regularizations,
 * reassignments…). `onConfirm` may ask for a reauth code itself; a cancelled
 * reauth simply keeps the dialog open. Other errors are shown in the dialog.
 */
export function ReasonDialog({ open, onOpenChange, title, description, label = 'Motif', placeholder, minLength = 5, required = true, confirmLabel, tone = 'primary', children, onConfirm }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  label?: string;
  placeholder?: string;
  minLength?: number;
  required?: boolean;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  /** Extra fields shown above the reason. */
  children?: ReactNode;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setReason(''); setError(''); } }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const clean = reason.trim();
    if (required && clean.length < minLength) { setError(`Écrivez un motif d’au moins ${minLength} caractères.`); return; }
    setBusy(true);
    setError('');
    try {
      await onConfirm(clean);
      onOpenChange(false);
    } catch (err) {
      if (!isReauthCancelled(err)) setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          {children}
          <Field label={label} required={required} error={error || undefined}>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder={placeholder} rows={3} />
          </Field>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
            <Button type="submit" variant={tone === 'danger' ? 'danger' : 'primary'} loading={busy}>{confirmLabel}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
