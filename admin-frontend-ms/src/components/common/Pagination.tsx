import React from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { Button } from '../ui';

interface PaginationProps {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
}

/**
 * Previous / next under a list when only the page count is known (the kit
 * Pagination needs the total too). 44 px targets on phones.
 */
const Pagination: React.FC<PaginationProps> = ({ currentPage, totalPages, onPageChange }) => {
    if (totalPages <= 1) return null;
    return (
        <nav className="flex items-center justify-between gap-3 border-t border-line px-4 py-3" aria-label="Pagination">
            <Button variant="outline" className="h-11 sm:h-9" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage <= 1}>
                <HugeiconsIcon icon={ArrowLeft01Icon} size={16} aria-hidden="true" />
                Précédent
            </Button>
            <span className="text-sm text-fg-muted tabular-nums">Page {currentPage} sur {totalPages}</span>
            <Button variant="outline" className="h-11 sm:h-9" onClick={() => onPageChange(currentPage + 1)} disabled={currentPage >= totalPages}>
                Suivant
                <HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden="true" />
            </Button>
        </nav>
    );
};

export default Pagination;
