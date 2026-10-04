import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';

export function Pagination({ page, totalPages, onChange, total }: { page: number; totalPages: number; onChange: (p: number) => void; total?: number }) {
    if (totalPages <= 1) return total !== undefined ? <p className="mt-3 text-xs text-ink-3 text-center">{total} au total</p> : null;
    return (
        <div className="mt-4 flex items-center justify-between gap-3">
            <Button variant="secondary" size="sm" icon={<ChevronLeft size={16} />} disabled={page <= 1} onClick={() => onChange(page - 1)}>Précédent</Button>
            <span className="text-sm text-ink-2 tabular">Page {page} sur {totalPages}{total !== undefined && <span className="hidden sm:inline text-ink-3"> · {total} au total</span>}</span>
            <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Suivant<ChevronRight size={16} /></Button>
        </div>
    );
}
