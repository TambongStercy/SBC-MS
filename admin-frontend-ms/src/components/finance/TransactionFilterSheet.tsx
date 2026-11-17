import { useState } from 'react';
import { Dialog, Field, Input, Select } from '../ui';
import { FiltersSheet } from './shared';

export interface ExtraFilters {
  currency: string;
  minAmount: string;
  maxAmount: string;
}

export const EMPTY_EXTRA: ExtraFilters = { currency: '', minAmount: '', maxAmount: '' };

export const countExtra = (f: ExtraFilters) => Object.values(f).filter(Boolean).length;

/**
 * Currency and amount range for a transactions list, edited in a sheet and
 * applied together ("Appliquer"). Dates come from the shared period filter.
 */
export function TransactionFilterSheet({ open, onOpenChange, value, onApply, currencies }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: ExtraFilters;
  onApply: (f: ExtraFilters) => void;
  currencies: { value: string; label: string }[];
}) {
  const [draft, setDraft] = useState<ExtraFilters>(value);
  const [wasOpen, setWasOpen] = useState(false);
  // Each opening starts from what is applied now.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft(value);
  }

  const put = (k: keyof ExtraFilters) => (v: string) => setDraft(d => ({ ...d, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <FiltersSheet onApply={() => onApply(draft)} onReset={() => setDraft(EMPTY_EXTRA)}>
          <Field label="Devise">
            <Select
              className="h-11"
              value={draft.currency || 'all'}
              onValueChange={v => put('currency')(v === 'all' ? '' : v)}
              options={[{ value: 'all', label: 'Toutes les devises' }, ...currencies]}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Montant min.">
              <Input className="h-11" type="number" inputMode="decimal" min={0} value={draft.minAmount} onChange={e => put('minAmount')(e.target.value)} placeholder="ex. 100" />
            </Field>
            <Field label="Montant max.">
              <Input className="h-11" type="number" inputMode="decimal" min={0} value={draft.maxAmount} onChange={e => put('maxAmount')(e.target.value)} placeholder="ex. 5000" />
            </Field>
          </div>
        </FiltersSheet>
      )}
    </Dialog>
  );
}
