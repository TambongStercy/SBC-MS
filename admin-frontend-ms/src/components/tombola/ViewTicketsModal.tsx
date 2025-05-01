import React from 'react';
import { TombolaTicket, TombolaMonth } from '../../services/adminTombolaApi'; // Assuming interfaces are here or adjust path
import Pagination from '../common/Pagination'; // Reuse pagination
import { format, parseISO } from 'date-fns';

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
    if (!dateString) return 'N/A';
    try {
        return format(parseISO(dateString), 'MMM dd, yyyy, hh:mm a');
    } catch (error) {
        return 'Invalid Date';
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
        <div className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-50 p-4">
            {/* Wider modal for ticket list */}
            <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
                <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-3">
                    <h2 className="text-xl font-semibold text-white">
                        Tickets for Tombola: {`${String(tombolaMonth.month).padStart(2, '0')}/${tombolaMonth.year}`}
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>

                {/* Search Input - Added Here */}
                <div className="mb-4 relative">
                    <input
                        type="text"
                        placeholder="Search by Name, Email, Phone..."
                        value={searchTerm}
                        onChange={onSearchChange}
                        className="block w-full pl-10 pr-3 py-2 border border-gray-600 rounded-md leading-5 bg-gray-700 text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <i className="fas fa-search text-gray-400"></i>
                    </div>
                </div>

                {/* Ticket Table Container */}
                <div className="overflow-y-auto flex-grow mb-4">
                    <table className="min-w-full divide-y divide-gray-700">
                        <thead className="bg-gray-700 sticky top-0"> {/* Sticky header */}
                            <tr>
                                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Ticket ID</th>
                                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Ticket No.</th>
                                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">User Name</th>
                                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">User Phone</th>
                                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">User ID</th>
                                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Purchase Date</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-600">
                            {isLoading && (
                                <tr>
                                    <td colSpan={6} className="px-4 py-4 text-center text-sm text-gray-400">Loading tickets...</td>
                                </tr>
                            )}
                            {!isLoading && tickets.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-4 py-4 text-center text-sm text-gray-400">No tickets found for this tombola month.</td>
                                </tr>
                            )}
                            {!isLoading && tickets.map((ticket) => (
                                <tr key={ticket._id} className="hover:bg-gray-700">
                                    <td className="px-4 py-3 whitespace-nowrap text-xs font-mono text-gray-400">{ticket.ticketId}</td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold text-gray-100">{ticket.ticketNumber}</td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300">{ticket.userName || 'N/A'}</td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300">{ticket.userPhoneNumber || 'N/A'}</td>
                                    <td className="px-4 py-3 whitespace-nowrap text-xs font-mono text-gray-400">{ticket.userId}</td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300">{formatDate(ticket.purchaseTimestamp)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Footer with Pagination */}
                <div className="pt-4 border-t border-gray-700">
                    {totalTickets > 0 && totalPages > 1 && (
                        <Pagination
                            currentPage={currentPage}
                            totalPages={totalPages}
                            onPageChange={onPageChange}
                        />
                    )}
                    <div className="text-sm text-gray-400 mt-2 text-center">Total tickets found: {totalTickets}</div>
                </div>
            </div>
        </div>
    );
};

export default ViewTicketsModal; 