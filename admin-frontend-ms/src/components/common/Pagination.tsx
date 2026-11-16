import React from 'react';

interface PaginationProps {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
}

const Pagination: React.FC<PaginationProps> = ({
    currentPage,
    totalPages,
    onPageChange
}) => {
    if (totalPages <= 1) {
        return null; // Don't render pagination if there's only one page or less
    }

    const handlePrevious = () => {
        if (currentPage > 1) {
            onPageChange(currentPage - 1);
        }
    };

    const handleNext = () => {
        if (currentPage < totalPages) {
            onPageChange(currentPage + 1);
        }
    };

    // Basic pagination display - can be enhanced later
    // Generate page numbers (simplified example)
    const pageNumbers = [];
    for (let i = 1; i <= totalPages; i++) {
        pageNumbers.push(i);
    }

    return (
        <nav className="flex items-center justify-between border-t border-line px-4 py-3 sm:px-6 mt-6" aria-label="Pagination">
            <div className="flex flex-1 justify-between sm:justify-end">
                <button
                    onClick={handlePrevious}
                    disabled={currentPage === 1}
                    className="relative inline-flex items-center rounded-md bg-surface-2 px-3 py-2 text-sm font-semibold text-fg-muted ring-1 ring-inset ring-line-strong hover:bg-surface-3 focus-visible:outline-offset-0 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Précédent
                </button>
                <span className="text-sm text-fg-muted mx-4 self-center hidden sm:inline">
                    Page {currentPage} sur {totalPages}
                </span>
                <button
                    onClick={handleNext}
                    disabled={currentPage === totalPages}
                    className="relative ml-3 inline-flex items-center rounded-md bg-surface-2 px-3 py-2 text-sm font-semibold text-fg-muted ring-1 ring-inset ring-line-strong hover:bg-surface-3 focus-visible:outline-offset-0 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Suivant
                </button>
            </div>
            {/* Optional: Add detailed page number links here if needed */}
        </nav>
    );
};

export default Pagination; 