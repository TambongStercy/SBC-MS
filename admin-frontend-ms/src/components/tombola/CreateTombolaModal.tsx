import { useEffect, useState } from 'react';
import { Button, Dialog, DialogClose, DialogContent, Field, Select } from '../ui';
import { Notice } from '../moduleKit';
import { MONTH_NAMES, monthLabel } from './labels';

/** Create the tombola of a month (current year or the 5 before it; never a future year). */
export default function CreateTombolaModal({ isOpen, isLoading, onSave, onClose }: {
  isOpen: boolean;
  isLoading: boolean;
  onSave: (month: number, year: number) => Promise<void>;
  onClose: () => void;
}) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (isOpen) setError(null); }, [isOpen]);

  const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear - i);

  const save = async () => {
    setError(null);
    if (month < 1 || month > 12) { setError('Le mois doit être compris entre 1 et 12.'); return; }
    if (year > currentYear) { setError('Impossible de créer une tombola pour une année future.'); return; }
    try {
      await onSave(month, year);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La tombola n’a pas pu être créée.');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={o => { if (!o && !isLoading) onClose(); }}>
      <DialogContent
        size="sm"
        title="Nouvelle tombola"
        description="Une tombola par mois : les membres y achètent leurs tickets jusqu’au tirage."
        footer={(
          <>
            <DialogClose asChild><Button variant="outline" size="lg" disabled={isLoading}>Annuler</Button></DialogClose>
            <Button variant="primary" size="lg" loading={isLoading} onClick={() => void save()}>Créer la tombola de {monthLabel(month, year)}</Button>
          </>
        )}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mois">
            <Select value={String(month)} onValueChange={v => setMonth(Number(v))} disabled={isLoading}
              options={MONTH_NAMES.map((m, i) => ({ value: String(i + 1), label: m }))} className="h-11 sm:h-9" />
          </Field>
          <Field label="Année">
            <Select value={String(year)} onValueChange={v => setYear(Number(v))} disabled={isLoading}
              options={yearOptions.map(y => ({ value: String(y), label: String(y) }))} className="h-11 sm:h-9" />
          </Field>
        </div>
        {error && <Notice tone="danger" className="mt-4">{error}</Notice>}
      </DialogContent>
    </Dialog>
  );
}
