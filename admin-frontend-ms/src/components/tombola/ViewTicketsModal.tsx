import React from 'react';
import { TombolaTicket, TombolaMonth } from '../../services/adminTombolaApi'; // Assuming interfaces are here or adjust path
import Pagination from '../common/Pagination'; // Reuse pagination
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { HugeiconsIcon } from '@hugeicons/react';
import { Search01Icon } from '@hugeicons/core-free-icons';

interface ViewTicketsModalProps {
    isOpen: boolean;
    isLoading: boolean;
    tombolaMonth: TombolaMonth | null; // Pass the whole month for context
    tickets: TombolaTicket[];
    currentPage: number;
    totalPages: number;
    totalTickets: number;
    onClose: () => void;
    onPageChange: (page: number) => void;
    searchTerm: string;
    onSearchChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

// Helper to format date strings (or import from parent/utils)
const formatDate = (dateString?: string) => {
    if (!dateString) return '—';
    try {
        return format(parseISO(dateString), 'dd MMM yyyy, HH:mm', { locale: fr });
    } catch (error) {
        return 'Date invalide';
    }
};

const ViewTicketsModal: React.FC<ViewTicketsModalProps> = ({
    isOpen,
    isLoading,
    tombolaMonth,
    tickets,
    currentPage,
    totalPages,
    totalTickets,
    onClose,
    onPageChange,
    searchTerm,
    onSearchChange
}) => {
    if (!isOpen || !tombolaMonth) {
        return null;
    }

    return (
        <div className="fixed inset-0 bg-black/75 flex justify-center items-center z-50 p-4">
            {/* Wider modal for ticket list */}
            <div className="bg-surface p-6 rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col border border-line">
                <div className="flex justify-between items-center mb-4 border-b border-line pb-3">
                    <h2 className="text-xl font-semibold text-fg">
                        Tickets de la tombola {`${String(tombolaMonth.month).padStart(2, '0')}/${tombolaMonth.year}`}
                    </h2>
                    <button onClick={onClose} className="text-fg-muted hover:text-fg" aria-label="Fermer">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>

                {/* Search Input - Added Here */}
                <div className="mb-4 relative">
                    <input
                        type="text"
                        placeholder="Rechercher par nom, e-mail ou téléphone"
                        value={searchTerm}
                        onChange={onSearchChange}
                        className="block w-full pl-10 pr-3 py-2 border border-line-strong rounded-md leading-5 bg-surface text-fg placeholder-fg-subtle focus:outline-hidden focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <HugeiconsIcon icon={Search01Icon} size={16} className="text-fg-muted" />
                    </div>
                </div>

                {/* Ticket Table Container */}
                <div className="overflow-y-auto grow mb-4">
                    <table className="min-w-full divide-y divide-line">
                        <thead className="bg-surface-2 sticky top-0"> {/* Sticky header */}
                            <tr>
                                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">ID du ticket</th>
                                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">N° du ticket</th>
                                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">Nom</th>
                                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">Téléphone</th>
                                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">ID utilisateur</th>
                                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">Date d’achat</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-line-strong">
                            {isLoading && (
                                <tr>
                                    <td colSpan={6} className="px-4 py-4 text-center text-sm text-fg-muted">Chargement des tickets…</td>
                                </tr>
                            )}
                            {!isLoading && tickets.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-4 py-4 text-center text-sm text-fg-muted">Aucun ticket pour cette tombola.</td>
                                </tr>
                            )}
                            {!isLoading && tickets.map((ticket) => (
                                <tr key={ticket._id} className="hover:bg-surface-2">
                                    <td className="px-4 py-3 whitespace-nowrap text-xs font-mono text-fg-muted">{ticket.ticketId}</td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold text-fg">{ticket.ticketNumber}</td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-fg-muted">{ticket.userName || '—'}</td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-fg-muted">{ticket.userPhoneNumber || '—'}</td>
                                    <td className="px-4 py-3 whitespace-nowrap text-xs font-mono text-fg-muted">{ticket.userId}</td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-fg-muted">{formatDate(ticket.purchaseTimestamp)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Footer with Pagination */}
                <div className="pt-4 border-t border-line">
                    {totalTickets > 0 && totalPages > 1 && (
                        <Pagination
                            currentPage={currentPage}
                            totalPages={totalPages}
                            onPageChange={onPageChange}
                        />
                    )}
                    <div className="text-sm text-fg-muted mt-2 text-center">Tickets trouvés : {totalTickets.toLocaleString('fr-FR')}</div>
                </div>
            </div>
        </div>
    );
};

export default ViewTicketsModal; 