import React, { useState, useEffect, useCallback } from 'react';
import {
    listTombolaMonths,
    createTombolaMonth,
    listTicketsForMonth,
    TombolaMonth,
    TombolaTicket,
    PaginationOptions,
    TombolaStatus,
    updateTombolaStatus
} from '../services/adminTombolaApi';
import Header from '../components/common/Header';
import Pagination from '../components/common/Pagination'; // Reuse pagination component
import CreateTombolaModal from '../components/tombola/CreateTombolaModal'; // <-- Import Create Modal
import ViewTicketsModal from '../components/tombola/ViewTicketsModal'; // <-- Import ViewTicketsModal
import ConfirmationModal from '../components/common/ConfirmationModal'; // Import ConfirmationModal
import { format, parseISO } from 'date-fns'; // For date formatting
import toast from 'react-hot-toast';
import { debounce } from 'lodash'; // Import debounce
import { useNavigate } from 'react-router-dom'; // Import useNavigate

// Helper to format date strings
const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    try {
        return format(parseISO(dateString), 'MMM dd, yyyy, hh:mm a'); // Example format
    } catch (error) {
        console.error("Error formatting date:", dateString, error);
        return 'Invalid Date';
    }
};

// Helper for status badges
const getStatusBadge = (status: TombolaStatus) => {
    switch (status) {
        case TombolaStatus.OPEN:
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">OPEN</span>;
        case TombolaStatus.CLOSED:
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">CLOSED</span>;
        case TombolaStatus.DRAWING:
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800">DRAWING</span>;
        default:
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">UNKNOWN</span>;
    }
};

function TombolaManagementPage() {
    const [tombolas, setTombolas] = useState<TombolaMonth[]>([]);
    const [pagination, setPagination] = useState<PaginationOptions>({ page: 1, limit: 10 });
    const [totalPages, setTotalPages] = useState(1);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false); // Loading state for create action

    // --- State for View Tickets Modal ---
    const [isViewTicketsModalOpen, setIsViewTicketsModalOpen] = useState<boolean>(false);
    const [selectedTombolaForTickets, setSelectedTombolaForTickets] = useState<TombolaMonth | null>(null);
    const [tickets, setTickets] = useState<TombolaTicket[]>([]);
    const [ticketsPagination, setTicketsPagination] = useState<PaginationOptions>({ page: 1, limit: 15 }); // Separate pagination for tickets
    const [ticketsTotalPages, setTicketsTotalPages] = useState(1);
    const [ticketsTotalCount, setTicketsTotalCount] = useState(0);
    const [isLoadingTickets, setIsLoadingTickets] = useState<boolean>(false);
    // --- End State for View Tickets Modal ---

    // --- State for Ticket Search ---
    const [ticketsSearchTerm, setTicketsSearchTerm] = useState<string>("");
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState<string>(""); // State for debounced value
    // --- End State for Ticket Search ---

    // --- State for Status Change ---
    const [isConfirmStatusModalOpen, setIsConfirmStatusModalOpen] = useState<boolean>(false);
    const [tombolaToChangeStatus, setTombolaToChangeStatus] = useState<TombolaMonth | null>(null);
    const [targetStatus, setTargetStatus] = useState<TombolaStatus.OPEN | TombolaStatus.CLOSED | null>(null);
    const [isUpdatingStatus, setIsUpdatingStatus] = useState<boolean>(false);
    // --- End State for Status Change ---

    const navigate = useNavigate(); // Initialize navigate

    const fetchTombolas = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await listTombolaMonths(pagination);
            // Access data and pagination based on the revised interface
            setTombolas(response.data || []);
            setTotalPages(response.pagination?.totalPages || 1);
            // Ensure current page is sync with response in case API adjusted it
            if (response.pagination?.page && response.pagination.page !== pagination.page) {
                setPagination(prev => ({ ...prev, page: response.pagination.page }));
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'An unknown error occurred';
            setError(message);
            toast.error(`Failed to load tombolas: ${message}`);
            setTombolas([]);
            setTotalPages(1);
        } finally {
            setIsLoading(false);
        }
    }, [pagination]);

    useEffect(() => {
        fetchTombolas();
    }, [fetchTombolas]);

    const handlePageChange = (newPage: number) => {
        if (newPage > 0 && newPage <= totalPages) {
            setPagination(prev => ({ ...prev, page: newPage }));
        }
    };

    // --- Create Handlers ---
    const handleOpenCreateModal = () => {
        setIsCreateModalOpen(true);
    };

    const handleCloseCreateModal = () => {
        setIsCreateModalOpen(false);
    };

    const handleCreateTombola = async (month: number, year: number) => {
        setIsSubmitting(true);
        const loadingToastId = toast.loading('Creating new tombola...');
        try {
            const newTombola = await createTombolaMonth(month, year);
            console.log(newTombola);
            toast.success(`Successfully created tombola for ${String(month).padStart(2, '0')}/${year}.`, { id: loadingToastId });
            handleCloseCreateModal();
            fetchTombolas(); // Refresh the list
        } catch (err) {
            const message = err instanceof Error ? err.message : 'An unknown error occurred';
            console.error("Failed to create tombola:", err);
            toast.error(`Failed to create tombola: ${message}`, { id: loadingToastId });
            // Re-throw error so modal can display it if needed
            throw err;
        } finally {
            setIsSubmitting(false);
        }
    };
    // --- End Create Handlers ---

    // --- View Tickets Handlers ---
    const fetchTicketsForSelectedMonth = useCallback(async (currentSearchTerm: string) => {
        if (!selectedTombolaForTickets) return;

        setIsLoadingTickets(true);
        try {
            // Pass pagination and search term to the API call
            // Ensure the response type matches the actual structure { success, data, pagination?, message? }
            const response = await listTicketsForMonth(selectedTombolaForTickets._id, ticketsPagination, currentSearchTerm);

            // Adjusted access based on expected API response structure
            // Assuming response has { data: { tickets: Ticket[], ... }, pagination: { totalPages, totalCount, page } }
            if (response && response.data && response.data.tickets && response.pagination) {
                setTickets(response.data.tickets || []); // Access the 'tickets' array inside response.data
                setTicketsTotalPages(response.pagination.totalPages || 1);
                setTicketsTotalCount(response.pagination.totalCount || 0);
                // Sync local pagination state if API adjusted the page
                if (response.pagination.page && response.pagination.page !== ticketsPagination.page) {
                    setTicketsPagination(prev => ({ ...prev, page: response.pagination.page }));
                }
            } else {
                // Handle case where response might be missing expected fields even if successful
                throw new Error(response.message || 'Failed to fetch tickets: Invalid response structure');
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'An unknown error occurred';
            console.error("Failed to fetch tickets:", err);
            toast.error(`Failed to load tickets: ${message}`);
            setTickets([]);
            setTicketsTotalPages(1);
            setTicketsTotalCount(0);
        } finally {
            setIsLoadingTickets(false);
        }
    }, [selectedTombolaForTickets, ticketsPagination]);

    // Debounce the function that updates the search term used for fetching
    const debouncedSetFetcherSearchTerm = useCallback(
        debounce((value: string) => {
            setTicketsPagination(prev => ({ ...prev, page: 1 })); // Reset page to 1 on new search
            setDebouncedSearchTerm(value);
        }, 500), // 500ms delay
        [] // Empty dependency array for useCallback
    );

    // Handler for the search input change
    const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value;
        setTicketsSearchTerm(value); // Update the input value immediately
        debouncedSetFetcherSearchTerm(value); // Trigger the debounced update for fetching
    };

    // Trigger fetch when selected tombola, ticket page, or DEBOUNCED SEARCH TERM changes
    useEffect(() => {
        if (selectedTombolaForTickets && isViewTicketsModalOpen) {
            fetchTicketsForSelectedMonth(debouncedSearchTerm); // Use debounced search term
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedTombolaForTickets, ticketsPagination, isViewTicketsModalOpen, debouncedSearchTerm]); // Use debouncedSearchTerm

    const handleViewTickets = (tombola: TombolaMonth) => {
        setSelectedTombolaForTickets(tombola);
        setTicketsPagination({ page: 1, limit: 15 }); // Reset to page 1
        setTicketsSearchTerm(""); // Clear search term when opening modal
        setDebouncedSearchTerm(""); // Clear debounced search term
        setTickets([]); // Clear previous tickets
        setIsViewTicketsModalOpen(true);
        // Initial fetch is triggered by useEffect
    };

    const handleCloseViewTicketsModal = () => {
        setIsViewTicketsModalOpen(false);
        setSelectedTombolaForTickets(null);
        setTickets([]);
        setTicketsPagination({ page: 1, limit: 15 });
    };

    const handleTicketsPageChange = (newPage: number) => {
        if (newPage > 0 && newPage <= ticketsTotalPages) {
            setTicketsPagination(prev => ({ ...prev, page: newPage }));
        }
    };

    const handleGoToDrawPage = (tombolaId: string) => {
        navigate(`/tombola/draw/${tombolaId}`);
    };

    // --- End View Tickets Handlers ---

    // --- Status Change Handlers ---
    const openStatusConfirmation = (tombola: TombolaMonth, newStatus: TombolaStatus.OPEN | TombolaStatus.CLOSED) => {
        setTombolaToChangeStatus(tombola);
        setTargetStatus(newStatus);
        setIsConfirmStatusModalOpen(true);
    };

    const closeStatusConfirmation = () => {
        setIsConfirmStatusModalOpen(false);
        setTombolaToChangeStatus(null);
        setTargetStatus(null);
    };

    const confirmStatusUpdate = async () => {
        if (!tombolaToChangeStatus || targetStatus === null) return;

        setIsUpdatingStatus(true);
        const loadingToastId = toast.loading(`Updating status to ${targetStatus}...`);
        try {
            await updateTombolaStatus(tombolaToChangeStatus._id, targetStatus);
            toast.success('Tombola status updated successfully.', { id: loadingToastId });
            closeStatusConfirmation();
            fetchTombolas(); // Refresh the list
        } catch (err) {
            const message = err instanceof Error ? err.message : 'An unknown error occurred';
            console.error("Failed to update status:", err);
            toast.error(`Failed to update status: ${message}`, { id: loadingToastId });
            // Keep modal open on error?
            // closeStatusConfirmation(); // Optionally close even on error
        } finally {
            setIsUpdatingStatus(false);
        }
    };
    // --- End Status Change Handlers ---

    // TODO: Add handlers for Delete

    return (
        <div className="flex-1 overflow-auto relative z-10 bg-gray-900 text-white">
            <Header title="Tombola Management" />
            <main className="max-w-7xl mx-auto py-6 px-4 lg:px-8">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-semibold">All Tombola Months</h2>
                    <button
                        onClick={handleOpenCreateModal}
                        // Apply standard button styling
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 transition ease-in-out duration-150"
                    >
                        Create New Tombola
                    </button>
                </div>

                {isLoading ? (
                    <p>Loading tombolas...</p>
                ) : error ? (
                    <div className="bg-red-800 text-white p-3 rounded">Error: {error}</div>
                ) : (
                    <>
                        {/* Wrap the table container with overflow-x-auto */}
                        <div className="shadow overflow-hidden border-b border-gray-700 sm:rounded-lg mb-6 overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-700">
                                <thead className="bg-gray-700">
                                    <tr>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Month/Year</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Status</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Start Date</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Draw Date</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Tickets Sold</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Winners</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-gray-800 divide-y divide-gray-600">
                                    {tombolas.map((tombola) => (
                                        <tr key={tombola._id}>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">{`${String(tombola.month).padStart(2, '0')}/${tombola.year}`}</td>
                                            <td className="px-6 py-4 whitespace-nowrap">{getStatusBadge(tombola.status)}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{formatDate(tombola.startDate)}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{formatDate(tombola.drawDate)}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{tombola.lastTicketNumber ?? 0}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{tombola.winners?.length ?? 0}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                                                {/* --- ACTION BUTTONS --- */}
                                                <button
                                                    onClick={() => handleViewTickets(tombola)}
                                                    title="View Tickets"
                                                    className="px-3 py-1 text-xs font-semibold rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-blue-500 transition ease-in-out duration-150"
                                                >
                                                    View Tickets
                                                </button>

                                                {/* Conditional Draw Button */}
                                                {(tombola.status === TombolaStatus.OPEN || tombola.status === TombolaStatus.DRAWING) && (
                                                    <button
                                                        onClick={() => handleGoToDrawPage(tombola._id)}
                                                        title="Perform Draw"
                                                        className="px-3 py-1 text-xs font-semibold rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-green-500 transition ease-in-out duration-150"
                                                        disabled={tombola.lastTicketNumber === 0} // Disable if no tickets
                                                    >
                                                        {tombola.lastTicketNumber === 0 ? 'Draw (No Tickets)' : 'Perform Draw'}
                                                    </button>
                                                )}

                                                {/* NEW: View Draw Button for Closed Tombolas */}
                                                {tombola.status === TombolaStatus.CLOSED && (
                                                    <button
                                                        onClick={() => handleGoToDrawPage(tombola._id)}
                                                        title="View Draw Results"
                                                        className="px-3 py-1 text-xs font-semibold rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-indigo-500 transition ease-in-out duration-150"
                                                    >
                                                        View Draw
                                                    </button>
                                                )}

                                                {/* Conditional Status Change Buttons */}
                                                {tombola.status === TombolaStatus.OPEN && (
                                                    <button
                                                        onClick={() => openStatusConfirmation(tombola, TombolaStatus.CLOSED)}
                                                        title="Close Tombola"
                                                        className="px-3 py-1 text-xs font-semibold rounded-md text-white bg-gray-500 hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-gray-400 transition ease-in-out duration-150"
                                                    >
                                                        Set Closed
                                                    </button>
                                                )}
                                                {tombola.status === TombolaStatus.CLOSED && (
                                                    <button
                                                        onClick={() => openStatusConfirmation(tombola, TombolaStatus.OPEN)}
                                                        title="Re-open Tombola"
                                                        className="px-3 py-1 text-xs font-semibold rounded-md text-gray-900 bg-yellow-500 hover:bg-yellow-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-yellow-400 transition ease-in-out duration-150"
                                                    >
                                                        Set Open
                                                    </button>
                                                )}

                                                {/* TODO: Add Delete Button with confirmation */}
                                                {/* <button
                                                    // onClick={() => handleDeleteTombola(tombola._id)} // Need delete handler
                                                    title="Delete Tombola"
                                                    className="px-3 py-1 text-xs font-semibold rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-red-500 transition ease-in-out duration-150"
                                                >
                                                    Delete
                                                </button> */}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <Pagination
                            currentPage={pagination.page ?? 1}
                            totalPages={totalPages ?? 1}
                            onPageChange={handlePageChange}
                        />
                    </>
                )}
            </main>

            {/* Modals */}
            <CreateTombolaModal
                isOpen={isCreateModalOpen}
                onClose={handleCloseCreateModal}
                onSave={handleCreateTombola}
                isLoading={isSubmitting}
            />
            <ViewTicketsModal
                isOpen={isViewTicketsModalOpen}
                onClose={handleCloseViewTicketsModal}
                tombolaMonth={selectedTombolaForTickets}
                tickets={tickets}
                isLoading={isLoadingTickets}
                currentPage={ticketsPagination.page ?? 1}
                totalPages={ticketsTotalPages ?? 1}
                totalTickets={ticketsTotalCount ?? 0}
                onPageChange={handleTicketsPageChange}
                searchTerm={ticketsSearchTerm}
                onSearchChange={handleSearchChange}
            />
            <ConfirmationModal
                isOpen={isConfirmStatusModalOpen}
                title={`Confirm Status Change`}
                message={`Are you sure you want to set the status of Tombola ${tombolaToChangeStatus ? `${String(tombolaToChangeStatus.month).padStart(2, '0')}/${tombolaToChangeStatus.year}` : ''} to ${targetStatus?.toUpperCase()}? ${targetStatus === TombolaStatus.OPEN ? 'This will close any other currently open tombola.' : ''}`}
                onConfirm={confirmStatusUpdate}
                onCancel={closeStatusConfirmation}
                confirmText={`Yes, Set to ${targetStatus?.toUpperCase()}`}
                isLoading={isUpdatingStatus}
            />
        </div>
    );
}

export default TombolaManagementPage; 