import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    getTombolaMonthDetails,
    performDraw,
    getAllTicketNumbersForMonth,
    TombolaMonth,
    TombolaStatus,
    Winner
} from '../services/adminTombolaApi';
import Header from '../components/common/Header';
import ConfirmationModal from '../components/common/ConfirmationModal'; // Assuming a reusable confirmation modal exists
import { format, parseISO } from 'date-fns';
import toast from 'react-hot-toast';
// Import AnimatePresence for exit animations if needed, and Variants
import { motion, AnimatePresence, Variants } from 'framer-motion';
import confetti from 'canvas-confetti'; // Import confetti library

// Helper to format date strings (consider moving to a utils file)
const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    try {
        return format(parseISO(dateString), 'MMM dd, yyyy, hh:mm a');
    } catch (error) {
        console.error("Error formatting date:", dateString, error);
        return 'Invalid Date';
    }
};

// Helper for status badges (consider moving to a utils file)
const getStatusBadge = (status?: TombolaStatus) => {
    if (!status) return null;
    switch (status) {
        case TombolaStatus.OPEN:
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">OPEN</span>;
        case TombolaStatus.CLOSED:
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">CLOSED</span>;
        case TombolaStatus.DRAWING: // Handle drawing status if applicable
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800">DRAWING</span>;
        default:
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">UNKNOWN</span>;
    }
};

// Define drawing states
type DrawingState = 'idle' | 'loading' | 'loading_numbers' | 'numbers_loaded' | 'drawing' | 'revealing' | 'done' | 'error';

// Define some ball colors
const ballColors = [
    'bg-blue-400', 'bg-red-400', 'bg-green-400', 'bg-yellow-400', 'bg-purple-400', 'bg-pink-400', 'bg-indigo-400', 'bg-teal-400'
];

// Define animation variants for the balls
const ballVariants: Variants = {
    initial: (_i: number) => ({
        y: Math.random() * 4 - 2,
        scale: 1,
        opacity: 0.8 // Start slightly transparent
    }),
    animate: (i: number) => ({
        // Add a subtle floating/jiggling animation
        y: [Math.random() * 4 - 2, Math.random() * 4 - 2], // Bounce between random points
        opacity: 1, // Fade in fully
        transition: {
            duration: Math.random() * 1 + 1.5, // Random duration between 1.5s and 2.5s
            repeat: Infinity,
            repeatType: "mirror", // Go back and forth smoothly
            ease: "easeInOut",
            delay: i * 0.02 // Stagger the start slightly
        } as const
    }),
    // Add a new variant for the drawing phase
    drawing: (i: number) => ({
        // Increase movement range for more chaos
        x: [0, Math.random() * 40 - 20, Math.random() * 40 - 20, 0],
        y: [0, Math.random() * 40 - 20, Math.random() * 40 - 20, 0],
        scale: [1, 1.1, 0.9, 1], // Add some scaling pulses
        rotate: [0, 0, 180, 360],  // Adjust rotation slightly
        opacity: [0.8, 1, 1, 0.8],
        transition: {
            duration: Math.random() * 0.5 + 0.3, // Faster, more erratic duration
            repeat: Infinity,
            // repeatType: "mirror", // Maybe remove mirror for more chaos?
            ease: "linear", // Could use linear or easeInOut
            delay: i * 0.01 // Slightly faster stagger
        }
    })
};

// Define variants for the ejected ball animation
const ejectedBallVariants: Variants = {
    initial: {
        // Start near the center of the container (adjust based on container size)
        x: 0,
        y: 0,
        scale: 1,
        opacity: 1,
    },
    exit: {
        x: 0,            // Moves horizontally out
        y: 150,          // Moves downwards out of view
        scale: 0.5,      // Shrinks
        opacity: 0,      // Fades out
        transition: {
            duration: 0.8, // Duration of exit animation
            ease: "easeOut"
        }
    }
};

function TombolaDrawPage() {
    const { monthId } = useParams<{ monthId: string }>();
    const navigate = useNavigate();
    const [tombola, setTombola] = useState<TombolaMonth | null>(null);
    // const [isLoading, setIsLoading] = useState(true); // REMOVED - Replaced by drawingState checks
    // const [isDrawing, setIsDrawing] = useState(false); // Replaced by drawingState
    const [error, setError] = useState<string | null>(null);
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);

    // New State for Animation and Data
    const [allTicketNumbers, setAllTicketNumbers] = useState<number[]>([]);
    const [isLoadingTicketNumbers, setIsLoadingTicketNumbers] = useState<boolean>(false);
    const [drawingState, setDrawingState] = useState<DrawingState>('idle');
    const [animatedWinners, setAnimatedWinners] = useState<Winner[]>([]); // Winners revealed visually one by one
    const [backendWinners, setBackendWinners] = useState<Winner[]>([]); // Winners from API response
    const [drawError, setDrawError] = useState<string | null>(null); // Specific error during draw
    const [revealIndex, setRevealIndex] = useState<number>(0); // State to track reveal progress
    const [ejectedBallNumber, setEjectedBallNumber] = useState<number | null>(null); // State for the ejected ball number
    const [revealedEjectedBalls, setRevealedEjectedBalls] = useState<number[]>([]); // State to store the sequence of visually ejected balls
    // State for winner user details
    const [winnerUserDetails, setWinnerUserDetails] = useState<Map<string, { name: string; country?: string }>>(new Map());
    const [isLoadingUserDetails, setIsLoadingUserDetails] = useState<boolean>(false);

    const fetchTombola = useCallback(async () => {
        if (!monthId) {
            setError("Tombola Month ID is missing.");
            setDrawingState('error'); // Set error state
            return;
        }
        // setIsLoading(true); // REMOVED
        setError(null);
        setDrawError(null); // Reset draw error on fetch
        setDrawingState('loading'); // Indicate loading details
        try {
            const data = await getTombolaMonthDetails(monthId);
            setTombola(data);
            // If already closed and has winners, store them but wait for numbers before setting state to done
            if (data.status === TombolaStatus.CLOSED && data.winners && data.winners.length > 0) {
                const sortedWinners = [...data.winners].sort((a, b) => a.rank - b.rank);
                setBackendWinners(sortedWinners);
                setAnimatedWinners(sortedWinners); // Show all winners at once if already drawn
                // Remove pre-population from here, it needs numbers which aren't loaded yet
                // setRevealedEjectedBalls(data.winners.map((_, index) => allTicketNumbers[index % allTicketNumbers.length] ?? -1)); 
                // Don't set state to done here yet, let the ticket fetcher do it
            }
            // Always set to idle after fetching details to trigger number fetch
            setDrawingState('idle');
        } catch (err) {
            const message = err instanceof Error ? err.message : 'An unknown error occurred';
            setError(`Failed to load tombola details: ${message}`);
            toast.error(`Failed to load tombola details: ${message}`);
            setTombola(null);
            setDrawingState('error'); // Set error state
        } finally {
            // setIsLoading(false); // REMOVED
        }
    }, [monthId]); // Keep only monthId dependency

    useEffect(() => {
        fetchTombola();
    }, [fetchTombola]); // Only fetchTombola needed as dependency

    // Fetch All Ticket Numbers Effect (runs when state is 'idle')
    useEffect(() => {
        // Only fetch numbers if tombola details loaded, it exists, and state is 'idle'
        if (tombola && tombola._id && drawingState === 'idle') {
            const fetchTicketNumbers = async () => {
                console.log('Fetching all ticket numbers...');
                setDrawingState('loading_numbers');
                setIsLoadingTicketNumbers(true);
                setDrawError(null); // Clear previous draw error
                setAllTicketNumbers([]); // Clear previous numbers
                try {
                    const numbers = await getAllTicketNumbersForMonth(tombola._id);
                    setAllTicketNumbers(numbers);
                    // Only transition if still in loading_numbers state
                    setDrawingState(prevState => prevState === 'loading_numbers' ? 'numbers_loaded' : prevState);
                    console.log(`Loaded ${numbers.length} ticket numbers.`);

                    // **NEW**: If tombola was already closed, now set state to done & pre-populate ejected balls visual
                    if (tombola.status === TombolaStatus.CLOSED) {
                        console.log('Tombola was already closed, setting state to done after loading numbers.');
                        // Pre-populate ejected balls visual state if winners exist
                        // Use the `numbers` array directly as it's available here
                        if (backendWinners && backendWinners.length > 0 && numbers.length > 0) {

                            const prePopulatedEjected = backendWinners.map(winner => winner.winningTicketNumber);
                            setRevealedEjectedBalls(prePopulatedEjected);
                            console.log('Pre-populated revealedEjectedBalls:', prePopulatedEjected);
                        }
                        setDrawingState('done');
                    }

                } catch (err) {
                    const message = err instanceof Error ? err.message : 'Failed to load ticket numbers';
                    console.error("Error fetching ticket numbers:", err);
                    setDrawError(`Failed to load ticket numbers: ${message}`);
                    // Only transition if still in loading_numbers state
                    setDrawingState(prevState => prevState === 'loading_numbers' ? 'error' : prevState);
                    setError(message); // Also set general error display
                } finally {
                    setIsLoadingTicketNumbers(false);
                }
            };

            // Check if we actually need to fetch (e.g., tombola is open or drawing)
            // This logic is now simplified: If we are idle and have tombola details, fetch numbers.
            fetchTicketNumbers(); // Call the function defined above
        }
    }, [tombola, drawingState, backendWinners]); // Add backendWinners dependency for pre-population

    // --- Add useEffect for Winner Reveal --- 
    useEffect(() => {
        let ejectionTimer: NodeJS.Timeout;
        let revealTimer: NodeJS.Timeout;

        // Check if we are in the revealing state and there are winners to reveal
        if (drawingState === 'revealing' && backendWinners.length > 0 && revealIndex < backendWinners.length) {

            // Step 1: Eject a ball visually
            const ballToEject = allTicketNumbers[revealIndex % allTicketNumbers.length]; // Pick a ball deterministically
            console.log(`Ejecting ball number: ${ballToEject} for winner rank ${backendWinners[revealIndex].rank}`);
            setEjectedBallNumber(ballToEject);
            // Store the ejected ball number
            setRevealedEjectedBalls(prev => [...prev, ballToEject]);

            // Step 2: Wait for ejection animation, then reveal winner
            ejectionTimer = setTimeout(() => {
                console.log('Ejection animation finished. Revealing winner.');
                setEjectedBallNumber(null); // Make ejected ball disappear

                // Short delay before showing winner details for smoother transition
                revealTimer = setTimeout(() => {
                    setAnimatedWinners(prev => [...prev, backendWinners[revealIndex]]);
                    setRevealIndex(prev => prev + 1); // Increment index for the next winner

                    // Trigger fireworks!
                    confetti({
                        particleCount: 150, // More particles
                        spread: 100,        // Wider spread
                        origin: { y: 0.6 } // Start slightly below the middle
                    });
                }, 200); // 200ms delay after ball disappears

            }, 800); // Wait 800ms (duration of ejection animation)

        } else if (drawingState === 'revealing' && backendWinners.length > 0 && revealIndex >= backendWinners.length) {
            // If revealing is done (index reached the end), change state to 'done'
            // Add a small delay before setting to done to allow last animation to finish
            const doneTimer = setTimeout(() => {
                console.log('Winner reveal sequence complete. Synchronizing revealed balls with actual winner ticket numbers.');
                // *** FIX: Update revealedEjectedBalls with the CORRECT winning ticket numbers ***
                const correctEjectedBalls = backendWinners.map(winner => winner.winningTicketNumber);
                setRevealedEjectedBalls(correctEjectedBalls);
                // Now set the state to done
                setDrawingState('done');
            }, 500); // Small delay
            return () => clearTimeout(doneTimer);
        }

        // Cleanup function to clear the timeouts if the component unmounts or dependencies change
        return () => {
            clearTimeout(ejectionTimer);
            clearTimeout(revealTimer);
        };

    }, [drawingState, backendWinners, revealIndex, allTicketNumbers, setEjectedBallNumber, setAnimatedWinners, setRevealIndex, setDrawingState, setRevealedEjectedBalls]); // Expanded dependencies

    // --- Add useEffect for fetching Winner User Details ---
    useEffect(() => {
        const fetchWinnerDetails = async () => {
            if (!backendWinners || backendWinners.length === 0) {
                setWinnerUserDetails(new Map()); // Clear details if no winners
                return;
            }

            const winnerIds = [...new Set(backendWinners.map(w => w.userId).filter(id => !!id))]; // Get unique, non-null IDs

            if (winnerIds.length === 0) {
                setWinnerUserDetails(new Map()); // Clear if no valid IDs
                return;
            }

            console.log('Fetching user details for winner IDs:', winnerIds);
            setIsLoadingUserDetails(true);
            try {
                // --- ASSUMPTION: getUsersDetailsByIds exists in adminUserApi --- 
                // Replace with your actual API call implementation
                // const users = await getUsersDetailsByIds(winnerIds); 
                // --- MOCK IMPLEMENTATION (Replace this) --- 
                await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay
                const users = winnerIds.map(id => ({
                    _id: id,
                    name: `Winner ${id.substring(0, 5)}...`, // Mock name
                    country: Math.random() > 0.5 ? 'Cameroon' : 'Nigeria' // Mock country
                }));
                // --- End Mock Implementation ---

                const userMap = new Map<string, { name: string; country?: string }>();
                users.forEach(user => {
                    if (user && user._id) {
                        userMap.set(user._id.toString(), { name: user.name, country: user.country });
                    }
                });
                setWinnerUserDetails(userMap);
                console.log('Successfully fetched winner user details.', userMap);
            } catch (err) {
                console.error("Failed to fetch winner user details:", err);
                toast.error('Could not load winner details.');
                // Optionally clear map on error or leave stale data?
                // setWinnerUserDetails(new Map()); 
            } finally {
                setIsLoadingUserDetails(false);
            }
        };

        fetchWinnerDetails();

    }, [backendWinners]); // Dependency: Run when backendWinners changes

    // --- Draw Logic (Modified) ---
    const handleDrawClick = useCallback(async () => {
        // Guard clause: Only allow draw if numbers loaded and tombola is in correct state
        if (!monthId || drawingState !== 'numbers_loaded' || !tombola || (tombola.status !== TombolaStatus.OPEN && tombola.status !== TombolaStatus.DRAWING)) {
            console.warn('Draw cannot be performed in the current state:', { monthId, drawingState, tombolaStatus: tombola?.status });
            toast.error('Cannot perform draw. Tombola might be closed or tickets not loaded.');
            return;
        }

        console.log('Starting draw API call...');
        setDrawingState('drawing'); // Set state to indicate drawing process started (triggers chaotic animation)
        setDrawError(null);
        setAnimatedWinners([]); // Clear previous visual winners if any
        setEjectedBallNumber(null); // Ensure no ball is ejected initially
        setRevealedEjectedBalls([]); // Clear previously ejected balls
        const loadingToastId = toast.loading('Performing winner draw...');

        // --- Simulate API call delay (REMOVE IN PRODUCTION) ---
        // await new Promise(resolve => setTimeout(resolve, 1500));
        // --- End Simulation ---

        try {
            // Make the actual API call to perform the draw
            const updatedTombola = await performDraw(monthId);
            console.log('Draw API call successful:', updatedTombola);

            // Update the main tombola state with the results (new status, winners, drawDate)
            setTombola(updatedTombola);

            if (updatedTombola && updatedTombola.winners && updatedTombola.winners.length > 0) {
                // Sort winners by rank before storing
                const sortedWinners = [...updatedTombola.winners].sort((a, b) => a.rank - b.rank);
                setBackendWinners(sortedWinners); // Store the actual sorted winners
                setAnimatedWinners([]); // Clear previously revealed visual winners
                setRevealIndex(0); // Reset the reveal index
                // *** CRITICAL: Set state to revealing AFTER API call success ***
                setDrawingState('revealing');
                toast.success('Draw successful! Revealing winners...', { id: loadingToastId });
            } else {
                // Handle case where draw might be successful but no winners (e.g., no tickets sold)
                setBackendWinners([]);
                setDrawingState('done'); // Go straight to 'done' if no winners
                toast.success('Draw completed. No winners found (perhaps no tickets were sold).', { id: loadingToastId });
                console.log('Draw completed, but no winners found.');
            }

        } catch (err) {
            const message = err instanceof Error ? err.message : 'An unknown error occurred during the draw';
            console.error("Error performing draw:", err);
            setDrawError(message);
            setDrawingState('error'); // Set error state
            toast.error(`Draw Failed: ${message}`, { id: loadingToastId });
        }
    }, [monthId, drawingState, tombola]); // Updated dependencies

    // This function is now only for the *confirmation* modal
    const handlePerformDraw = async () => {
        // This function is triggered by the CONFIRMATION modal
        // It should NOT contain the API logic itself, just trigger handleDrawClick
        setIsConfirmModalOpen(false); // Close confirmation modal
        handleDrawClick(); // Call the main draw logic function
    };
    // Remove unused isDrawing state setter from original handlePerformDraw
    // const [isDrawing, setIsDrawing] = useState(false); // Can remove this

    const openConfirmation = () => {
        // Only open if ready to draw
        if (drawingState === 'numbers_loaded' && tombola && (tombola.status === TombolaStatus.OPEN || tombola.status === TombolaStatus.DRAWING)) {
            setIsConfirmModalOpen(true);
        } else {
            toast.error("Cannot start draw in the current state.");
        }
    };

    const closeConfirmation = () => {
        setIsConfirmModalOpen(false);
    };

    // Calculate if the main draw button should be disabled
    const isDrawButtonDisabled = drawingState !== 'numbers_loaded' ||
        isLoadingTicketNumbers ||
        !tombola ||
        (tombola.status !== TombolaStatus.OPEN && tombola.status !== TombolaStatus.DRAWING);


    if (drawingState === 'loading') { // Use drawingState for initial loading
        return (
            <div className="flex-1 p-6 bg-gray-900 text-white">
                <Header title="Tombola Draw" />
                <p>Loading Tombola Details...</p>
            </div>
        );
    }

    if (error && drawingState === 'error' && !tombola) { // Show general error if tombola details failed to load
        return (
            <div className="flex-1 p-6 bg-gray-900 text-white">
                <Header title="Tombola Draw" />
                <div className="bg-red-800 text-white p-3 rounded mb-4">Error loading details: {error}</div>
                <button onClick={() => navigate('/tombola')} className="text-indigo-400 hover:text-indigo-300">Back to Tombola List</button>
            </div>
        );
    }

    if (!tombola) { // Simplified check: If tombola is null at this point (after loading attempts), render placeholder
        return (
            <div className="flex-1 p-6 bg-gray-900 text-white">
                <Header title="Tombola Draw" />
                <p>Tombola details are not available or still loading.</p>
                {error && <div className="bg-red-800 text-white p-3 rounded mb-4">Error: {error}</div>}
                <button onClick={() => navigate('/tombola')} className="text-indigo-400 hover:text-indigo-300">Back to Tombola List</button>
            </div>
        );
    }

    // Derived states based on the MAIN tombola object
    const canDraw = tombola.status === TombolaStatus.OPEN || tombola.status === TombolaStatus.DRAWING;
    const alreadyDrawn = tombola.status === TombolaStatus.CLOSED && tombola.winners && tombola.winners.length > 0;


    return (
        <div className="flex-1 overflow-auto relative z-10 bg-gray-900 text-white">
            <Header title={`Tombola Draw - ${String(tombola.month).padStart(2, '0')}/${tombola.year}`} />
            <main className="max-w-6xl mx-auto py-6 px-4 lg:px-8"> {/* Increased max-width */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8"> {/* Grid layout */}

                    {/* Column 1: Details & Existing Winners */}
                    <div className="md:col-span-1 bg-gray-800 shadow-md rounded-lg p-6 self-start">
                        <div className="mb-4 pb-4 border-b border-gray-700">
                            <h2 className="text-2xl font-semibold mb-2">Tombola Details</h2>
                            <p><strong>Month/Year:</strong> {`${String(tombola.month).padStart(2, '0')}/${tombola.year}`}</p>
                            <p><strong>Status:</strong> {getStatusBadge(tombola.status)}</p>
                            <p><strong>Start Date:</strong> {formatDate(tombola.startDate)}</p>
                            <p><strong>Tickets Sold (Estimate):</strong> {tombola.lastTicketNumber ?? 0}</p>
                            {tombola.drawDate && <p><strong>Draw Date:</strong> {formatDate(tombola.drawDate)}</p>}
                            {drawingState === 'error' && drawError && (
                                <p className="text-red-400 mt-2"><strong>Error:</strong> {drawError}</p>
                            )}
                        </div>

                        {/* Display final winners from the main tombola state if already drawn */}
                        {alreadyDrawn && (
                            <div className="mb-6">
                                <h3 className="text-xl font-semibold mb-3 text-green-400">Winners (Final)</h3>
                                <ul className="list-disc pl-5 space-y-2">
                                    {/* Sort winners by rank and display name/country */}
                                    {backendWinners.sort((a, b) => a.rank - b.rank).map((winner) => {
                                        // Lookup user details from the map
                                        const userDetails = winnerUserDetails.get(winner.userId);
                                        // Construct display name: Name (Country) or fallback to ID
                                        const displayName = userDetails
                                            ? `${userDetails.name}${userDetails.country ? ` (${userDetails.country})` : ''}`
                                            : `User ID: ${winner.userId}`;
                                        const loadingText = isLoadingUserDetails && !userDetails ? ' (Loading...)' : ''; // Show loading only if details are missing
                                        return (
                                            <li key={`final-${winner.rank}`}>
                                                <strong>Rank {winner.rank}:</strong> {winner.prize} - <span className="font-semibold text-yellow-300">(Ticket #{winner.winningTicketNumber})</span> - {displayName}{loadingText}
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        )}

                        {/* Show button to open confirmation modal if applicable */}
                        {!alreadyDrawn && canDraw && drawingState === 'numbers_loaded' && (
                            <div className="mt-6 text-center">
                                <button
                                    onClick={openConfirmation}
                                    disabled={isDrawButtonDisabled} // Use the calculated disabled state
                                    className="w-full px-6 py-3 bg-green-600 rounded hover:bg-green-700 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Confirm & Start Draw
                                </button>
                                {tombola.lastTicketNumber === 0 && (
                                    <p className="text-yellow-400 text-sm mt-2">Warning: No tickets sold. Draw will result in no winners.</p>
                                )}
                            </div>
                        )}

                        {/* Message if not ready for draw */}
                        {!alreadyDrawn && (!canDraw || (canDraw && drawingState !== 'numbers_loaded' && drawingState !== 'idle' && drawingState !== 'loading_numbers' && drawingState !== 'error')) && (
                            <div className="mt-6 text-center">
                                {drawingState === 'loading_numbers' && <p className="text-yellow-400">Loading ticket numbers...</p>}
                                {drawingState !== 'loading_numbers' && drawingState !== 'error' && <p className="text-yellow-500">Tombola not ready for draw (Status: {tombola.status}, State: {drawingState}).</p>}
                                {drawingState === 'error' && !drawError && <p className="text-red-500">An error occurred. Cannot proceed.</p>}
                            </div>
                        )}

                        {/* Message if already drawn */}
                        {alreadyDrawn && (
                            <div className="mt-6 text-center">
                                <p className="text-green-500">Winners have already been drawn for this tombola.</p>
                            </div>
                        )}


                        <div className="mt-8 text-center border-t border-gray-700 pt-4">
                            <button onClick={() => navigate('/tombola')} className="text-indigo-400 hover:text-indigo-300">Back to Tombola List</button>
                        </div>
                    </div>


                    {/* Column 2 & 3: Animation & Revealed Winners */}
                    <div className="md:col-span-2">
                        {/* --- Animation Area --- */}
                        <div className="flex flex-col items-center bg-gray-800 shadow-md rounded-lg p-6 mb-8">
                            <h2 className="text-2xl font-semibold mb-4 text-indigo-300">Drawing Machine</h2>

                            {drawingState === 'loading_numbers' && <p className="text-yellow-400 py-20">Loading tickets...</p>}
                            {drawingState === 'error' && drawError && <p className="text-red-400 py-20">Error loading tickets: {drawError}</p>}

                            {/* Show the machine only when numbers are loaded or during/after the drawing process */}
                            {(drawingState === 'numbers_loaded' || drawingState === 'drawing' || drawingState === 'revealing' || drawingState === 'done') && (
                                <motion.div
                                    // Explicitly remove border, border-yellow-400, border-indigo-500 and add filter for simulated border
                                    className={`relative w-64 h-64 flex items-center justify-center bg-gray-700 shadow-lg overflow-hidden mb-6 ${drawingState === 'drawing' || drawingState === 'revealing' ? 'animate-pulse' : ''}`}
                                    style={{
                                        clipPath: 'polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)', // Octagon shape
                                        filter: `drop-shadow(0 0 0 ${drawingState === 'drawing' || drawingState === 'revealing' ? '#FBBF24' : '#6366F1'}) drop-shadow(0 0 0 ${drawingState === 'drawing' || drawingState === 'revealing' ? '#FBBF24' : '#6366F1'}) drop-shadow(0 0 0 ${drawingState === 'drawing' || drawingState === 'revealing' ? '#FBBF24' : '#6366F1'}) drop-shadow(0 0 0 ${drawingState === 'drawing' || drawingState === 'revealing' ? '#FBBF24' : '#6366F1'})` // Simulate ~4px border thickness via multiple shadows
                                    }}
                                // Optional: Add spinning animation back if desired
                                // animate={{ rotate: 360 }}
                                // transition={{ loop: Infinity, ease: "linear", duration: 15 }}
                                >
                                    {/* Render balls inside - Animate prop is now dynamic */}
                                    {allTicketNumbers.length > 0 ? (
                                        allTicketNumbers.slice(0, 100).map((num, index) => { // Limit balls for performance if needed
                                            // *** FIX: Don't render winning balls inside the machine once the draw is done ***
                                            if (drawingState === 'done' && revealedEjectedBalls.includes(num)) {
                                                return null; // Don't render this ball
                                            }
                                            // Render the ball if not a winner or draw is not done
                                            return (
                                                <motion.div
                                                    key={`ball-${num}`}
                                                    className={`absolute w-8 h-8 ${ballColors[index % ballColors.length]} rounded-full flex items-center justify-center text-xs font-bold shadow-md`}
                                                    style={{
                                                        // Revert to random positioning
                                                        top: `${Math.random() * 85 + 7.5}%`,
                                                        left: `${Math.random() * 85 + 7.5}%`,
                                                        transform: 'translate(-50%, -50%)',
                                                        visibility: ejectedBallNumber === num ? 'hidden' : 'visible'
                                                    }}
                                                    variants={ballVariants}
                                                    initial="initial"
                                                    animate={drawingState === 'drawing' || drawingState === 'revealing' ? "drawing" : "animate"}
                                                    custom={index}
                                                >
                                                    {/* Inner span for white background on number */}
                                                    <span className="w-5 h-5 bg-white rounded-full flex items-center justify-center text-black text-xs font-bold">
                                                        {num}
                                                    </span>
                                                </motion.div>
                                            );
                                        })
                                    ) : (
                                        // Show message inside machine if numbers loaded but array is empty
                                        drawingState === 'numbers_loaded' && <p className="text-gray-400">No tickets sold</p>
                                    )}
                                    {/* Render the Ejected Ball - Place it relative to the container above */}
                                    <AnimatePresence>
                                        {ejectedBallNumber !== null && (
                                            <motion.div
                                                key={`ejected-${ejectedBallNumber}`}
                                                className={`absolute w-8 h-8 ${ballColors[allTicketNumbers.indexOf(ejectedBallNumber) % ballColors.length]} rounded-full flex items-center justify-center text-xs font-bold shadow-md z-20`}
                                                style={{ top: '50%', left: '50%' }} // Adjust if container position changes
                                                variants={ejectedBallVariants}
                                                initial="initial"
                                                exit="exit"
                                            >
                                                <span className="w-5 h-5 bg-white rounded-full flex items-center justify-center text-black text-xs font-bold">
                                                    {ejectedBallNumber}
                                                </span>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </motion.div>
                            )}
                            {/* Display state message below machine */}
                            <div className="h-6 mt-2 text-center"> {/* Placeholder for status message */}
                                {drawingState === 'drawing' && <p className="text-yellow-400 animate-pulse">Drawing winners...</p>}
                                {drawingState === 'revealing' && <p className="text-blue-400 animate-pulse">Revealing winners...</p>}
                                {drawingState === 'done' && animatedWinners.length > 0 && <p className="text-green-400">Draw complete!</p>}
                                {drawingState === 'done' && backendWinners.length === 0 && <p className="text-gray-400">Draw complete. No winners were found.</p>}
                                {/* Error shown in details pane */}
                            </div>
                        </div>
                        {/* --- End Animation Area --- */}


                        {/* --- Winners Display Area (Animated Reveal) --- */}
                        <div className="bg-gray-800 shadow-md rounded-lg p-6 min-h-[200px]"> {/* Added min-height */}
                            <h3 className="text-xl font-semibold mb-4 text-indigo-300 border-b border-gray-700 pb-2">
                                {drawingState === 'revealing' ? 'Revealing Winners...' : (drawingState === 'done' && animatedWinners.length > 0) ? 'Winners Announced' : 'Awaiting Draw...'}
                            </h3>
                            {drawingState !== 'revealing' && drawingState !== 'done' && (
                                <p className="text-gray-500 text-center pt-8">Winners will appear here after the draw.</p>
                            )}
                            {(drawingState === 'revealing' || (drawingState === 'done' && animatedWinners.length > 0)) && (
                                <motion.ul layout className="space-y-3">
                                    <AnimatePresence>
                                        {animatedWinners.map((winner, index) => {
                                            // Add guard clause to prevent runtime error if winner is unexpectedly undefined
                                            if (!winner) {
                                                console.warn(`Rendering null for undefined winner at index ${index}`);
                                                return null;
                                            }
                                            return (
                                                <motion.li
                                                    layout
                                                    key={winner.rank} // Use rank as key since it's unique per draw
                                                    initial={{ opacity: 0, x: -50 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    exit={{ opacity: 0 }} // Optional exit animation if list changes dynamically
                                                    transition={{ duration: 0.5, delay: index * 0.1 }} // Stagger appearance slightly
                                                    className="p-3 bg-gray-700 rounded-md shadow flex items-center space-x-4"
                                                >
                                                    <span className={`text-lg font-bold ${winner.rank === 1 ? 'text-yellow-400' : winner.rank === 2 ? 'text-gray-300' : 'text-orange-400'}`}>
                                                        Rank #{winner.rank}
                                                    </span>
                                                    <span className="flex-1 text-lg text-white">
                                                        {winner.prize} <span className="font-semibold text-yellow-300 text-base">(Ticket #{winner.winningTicketNumber})</span>
                                                    </span>
                                                    {/* Display Name/Country instead of ID */}
                                                    <span className="text-sm text-gray-400 min-w-[150px] text-right">
                                                        {isLoadingUserDetails && !winnerUserDetails.has(winner.userId) ? (
                                                            <span className="italic">Loading...</span>
                                                        ) : winnerUserDetails.has(winner.userId) ? (
                                                            // Display Name and Country if available
                                                            <>
                                                                <span>{winnerUserDetails.get(winner.userId)?.name}</span>
                                                                {winnerUserDetails.get(winner.userId)?.country && (
                                                                    <span className="ml-1">({winnerUserDetails.get(winner.userId)?.country})</span>
                                                                )}
                                                            </>
                                                        ) : (
                                                            // Fallback to User ID if details not found
                                                            <span className="font-mono text-xs">ID: {winner.userId}</span>
                                                        )}
                                                    </span>
                                                    {/* Add the ejected ball display here */}
                                                    {drawingState === 'done' && revealedEjectedBalls[index] !== undefined && (
                                                        <div className="ml-2 flex items-center flex-shrink-0" title={`Visually Ejected Ball: ${revealedEjectedBalls[index]}`}>
                                                            <span className="text-xs text-gray-400 mr-1">(Ball:</span>
                                                            <div className={`w-5 h-5 ${ballColors[allTicketNumbers.indexOf(revealedEjectedBalls[index]) % ballColors.length]} rounded-full flex items-center justify-center text-xs font-bold shadow-sm`}>
                                                                <span className="w-3 h-3 bg-white rounded-full flex items-center justify-center text-black text-[8px] font-bold">
                                                                    {revealedEjectedBalls[index]}
                                                                </span>
                                                            </div>
                                                            <span className="text-xs text-gray-400 ml-1">)</span>
                                                        </div>
                                                    )}
                                                </motion.li>
                                            );
                                        })}
                                    </AnimatePresence>
                                </motion.ul>
                            )}
                            {drawingState === 'done' && animatedWinners.length === 0 && backendWinners.length === 0 && (
                                <p className="text-gray-400 text-center pt-8">No winners were found for this tombola.</p>
                            )}
                        </div>
                        {/* --- End Winners Display Area --- */}
                    </div>

                </div> {/* End Grid */}
            </main>

            <ConfirmationModal
                isOpen={isConfirmModalOpen}
                title="Confirm Winner Draw"
                message={`Are you sure you want to perform the winner draw for Tombola ${String(tombola.month).padStart(2, '0')}/${tombola.year}? This action cannot be undone.`}
                onConfirm={handlePerformDraw} // Use the simplified confirmation handler
                onCancel={closeConfirmation}
                confirmText="Yes, Perform Draw"
                isLoading={drawingState === 'drawing'} // Show loading in modal only during the API call phase
            />
        </div>
    );
}

export default TombolaDrawPage;