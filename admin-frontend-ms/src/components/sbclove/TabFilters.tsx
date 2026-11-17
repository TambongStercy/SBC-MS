import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { ProfileStatus, ReportStatus } from '../../services/adminSbcLoveApi';
import { Button, Select } from '../ui';
import { FilterSelect, SearchInput } from '../moduleKit';
import { MEMBER_LIMITS, type LoveFilters } from './types';

const PROFILE_CHOICES = [
  { value: 'pending', label: 'À valider' },
  { value: 'approved', label: 'Approuvés' },
  { value: 'rejected', label: 'Refusés' },
  { value: 'suspended', label: 'Suspendus' },
  { value: 'all', label: 'Tous les statuts' },
];
const MEMBER_STATUS = [
  { value: ProfileStatus.PENDING, label: 'À valider' },
  { value: ProfileStatus.APPROVED, label: 'Approuvés' },
  { value: ProfileStatus.REJECTED, label: 'Refusés' },
  { value: ProfileStatus.SUSPENDED, label: 'Suspendus' },
];
const REPORT_STATUS_OPTIONS = [
  { value: ReportStatus.OPEN, label: 'Ouverts' },
  { value: ReportStatus.REVIEWED, label: 'Traités' },
  { value: ReportStatus.DISMISSED, label: 'Ignorés' },
];

const field = 'w-full sm:w-48';

/** How many of the current tab's own filters are set (status, search, page size). */
export function tabFilterCount(tab: string, f: LoveFilters): number {
  if (tab === 'config') return 0;
  return (f.values.status ? 1 : 0) + (tab !== 'reports' && f.values.q.trim() ? 1 : 0) + (tab === 'members' && f.values.limit ? 1 : 0);
}

export const clearTabFilters = (f: LoveFilters) => f.set({ status: '', q: '', limit: '' });

/**
 * The SBC Love tab's own filters, placed in the page's filter row after
 * country and period. Their own "Effacer" shows only while country/period
 * are not set (the row's button then clears everything).
 */
export function LoveTabFilters({ tab, f, rowFiltered }: { tab: string; f: LoveFilters; rowFiltered: boolean }) {
  if (tab === 'config') return null;
  const own = tabFilterCount(tab, f);
  return (
    <>
      {tab !== 'reports' && (
        <SearchInput value={f.values.q} onChange={q => f.set({ q })} placeholder="Pseudo, nom, e-mail, téléphone, ville" className="w-full sm:w-72" />
      )}
      {tab === 'profiles' && (
        <div className={field}>
          <span className="sr-only">Statut</span>
          <Select value={f.values.status || 'pending'} onValueChange={v => f.set({ status: v === 'pending' ? '' : v })} options={PROFILE_CHOICES} className="h-11 md:h-9" />
        </div>
      )}
      {tab === 'members' && (
        <>
          <FilterSelect label="Statut" value={f.values.status} onChange={status => f.set({ status })} allLabel="Tous les statuts" options={MEMBER_STATUS} className={field} />
          <div className="w-full sm:w-36">
            <span className="sr-only">Membres par page</span>
            <Select
              value={f.values.limit || '25'}
              onValueChange={v => f.set({ limit: v === '25' ? '' : v })}
              options={MEMBER_LIMITS.map(n => ({ value: String(n), label: `${n} par page` }))}
              className="h-11 md:h-9"
            />
          </div>
        </>
      )}
      {tab === 'reports' && (
        <FilterSelect label="Statut" value={f.values.status} onChange={status => f.set({ status })} allLabel="Tous les statuts" options={REPORT_STATUS_OPTIONS} className={field} />
      )}
      {own > 0 && !rowFiltered && (
        <Button variant="ghost" size="sm" className="self-start sm:self-auto" onClick={() => clearTabFilters(f)}>
          <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" />
          Effacer les filtres
        </Button>
      )}
    </>
  );
}
