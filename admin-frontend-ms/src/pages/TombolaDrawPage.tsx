import { getUserDetails } from '../services/adminUserApi';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    getTombolaMonthDetails,
    performDraw,
    getAllTicketNumbersForMonth,
    TombolaMonth,
    TombolaStatus,
    Winner
} from '../services/adminTombolaApi';
import { toast } from 'sonner';
import { motion, AnimatePresence, Variants } from 'framer-motion';
import confetti from 'canvas-confetti';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft01Icon, Award01Icon, DiceIcon } from '@hugeicons/core-free-icons';
import { Can } from '../components/Can';
import { Button, EmptyState, PageHeader, Panel, PanelBody, PanelHeader, Skeleton } from '../components/ui';
import { ConfirmDialog, CopyId, DetailList, Notice, StatusBadge, formatDateTime, formatNumber } from '../components/moduleKit';
import { Prize, TOMBOLA_STATUS, monthLabel, monthTitle } from '../components/tombola/labels';

/**
 * Tirage d'une tombola (module `tombola`, the draw itself needs write): the
 * tombola's details, the draw machine (animated balls, then each winner
 * revealed with confetti) and the winners. The draw is final and notifies the
 * winners; the service draws only an OPEN tombola.
 */

// Define drawing states
type DrawingState = 'idle' | 'loading' | 'loading_numbers' | 'numbers_loaded' | 'drawing' | 'revealing' | 'done' | 'error';

// The six chart colours, in their fixed order (decoration only)
const ballColors = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];
const ballColor = (i: number) => ballColors[((i % ballColors.length) + ballColors.length) % ballColors.length];

// Define animation variants for the balls
const ballVariants: Variants = {
    initial: () => ({
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
            setError("Identifiant de la tombola manquant.");
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
            const message = err instanceof Error ? err.message : 'Erreur inconnue';
            setError(`Impossible de charger la tombola : ${message}`);
            toast.error(`Impossible de charger la tombola : ${message}`);
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
                setDrawingState('loading_numbers');
                setIsLoadingTicketNumbers(true);
                setDrawError(null); // Clear previous draw error
                setAllTicketNumbers([]); // Clear previous numbers
                try {
                    const numbers = await getAllTicketNumbersForMonth(tombola._id);
                    setAllTicketNumbers(numbers);
                    // Only transition if still in loading_numbers state
                    setDrawingState(prevState => prevState === 'loading_numbers' ? 'numbers_loaded' : prevState);

                    // **NEW**: If tombola was already closed, now set state to done & pre-populate ejected balls visual
                    if (tombola.status === TombolaStatus.CLOSED) {
                        // Pre-populate ejected balls visual state if winners exist
                        // Use the `numbers` array directly as it's available here
                        if (backendWinners && backendWinners.length > 0 && numbers.length > 0) {

                            const prePopulatedEjected = backendWinners.map(winner => winner.winningTicketNumber);
                            setRevealedEjectedBalls(prePopulatedEjected);
                        }
                        setDrawingState('done');
                    }

                } catch (err) {
                    const message = err instanceof Error ? err.message : 'Impossible de charger les numéros de tickets';
                    console.error("Error fetching ticket numbers:", err);
                    setDrawError(`Impossible de charger les numéros de tickets : ${message}`);
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
            setEjectedBallNumber(ballToEject);
            // Store the ejected ball number
            setRevealedEjectedBalls(prev => [...prev, ballToEject]);

            // Step 2: Wait for ejection animation, then reveal winner
            ejectionTimer = setTimeout(() => {
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

            setIsLoadingUserDetails(true);
            try {
                // The real members: one admin lookup per winner (a draw has a handful).
                const users = (await Promise.all(winnerIds.map(id => getUserDetails(id).catch(() => null))))
                    .filter((u): u is NonNullable<typeof u> => !!u);

                const userMap = new Map<string, { name: string; country?: string }>();
                users.forEach(user => {
                    if (user && user._id) {
                        userMap.set(user._id.toString(), { name: user.name, country: user.country });
                    }
                });
                setWinnerUserDetails(userMap);
            } catch (err) {
                console.error("Failed to fetch winner user details:", err);
                toast.error('Impossible de charger les informations des gagnants.');
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
            toast.error('Tirage impossible : la tombola est peut-être fermée ou les tickets ne sont pas chargés.');
            return;
        }

        setDrawingState('drawing'); // Set state to indicate drawing process started (triggers chaotic animation)
        setDrawError(null);
        setAnimatedWinners([]); // Clear previous visual winners if any
        setEjectedBallNumber(null); // Ensure no ball is ejected initially
        setRevealedEjectedBalls([]); // Clear previously ejected balls
        const loadingToastId = toast.loading('Tirage des gagnants…');

        // --- Simulate API call delay (REMOVE IN PRODUCTION) ---
        // await new Promise(resolve => setTimeout(resolve, 1500));
        // --- End Simulation ---

        try {
            // Make the actual API call to perform the draw
            const updatedTombola = await performDraw(monthId);

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
                toast.success('Tirage effectué ! Révélation des gagnants…', { id: loadingToastId });
            } else {
                // Handle case where draw might be successful but no winners (e.g., no tickets sold)
                setBackendWinners([]);
                setDrawingState('done'); // Go straight to 'done' if no winners
                toast.success('Tirage terminé. Aucun gagnant (aucun ticket vendu ?).', { id: loadingToastId });
            }

        } catch (err) {
            const message = err instanceof Error ? err.message : 'Erreur inconnue pendant le tirage';
            console.error("Error performing draw:", err);
            setDrawError(message);
            setDrawingState('error'); // Set error state
            toast.error(`Échec du tirage : ${message}`, { id: loadingToastId });
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
            toast.error("Le tirage ne peut pas démarrer dans l’état actuel.");
        }
    };

    const closeConfirmation = () => {
        setIsConfirmModalOpen(false);
    };

    // One random position per ball, kept across renders
    const ballPositions = useMemo(
        () => allTicketNumbers.slice(0, 100).map(() => ({ top: Math.random() * 85 + 7.5, left: Math.random() * 85 + 7.5 })),
        [allTicketNumbers],
    );

    // Calculate if the main draw button should be disabled
    const isDrawButtonDisabled = drawingState !== 'numbers_loaded' ||
        isLoadingTicketNumbers ||
        !tombola ||
        (tombola.status !== TombolaStatus.OPEN && tombola.status !== TombolaStatus.DRAWING);


    const back = (
        <Button variant="outline" size="lg" className="w-full sm:w-auto" onClick={() => navigate('/tombola')}>
            <HugeiconsIcon icon={ArrowLeft01Icon} size={16} aria-hidden="true" />
            Retour aux tombolas
        </Button>
    );

    if (drawingState === 'loading' || (!tombola && !error)) {
        return (
            <div className="space-y-6">
                <PageHeader title="Tirage de la tombola" actions={back} />
                <div className="grid gap-4 lg:grid-cols-3">
                    <Skeleton className="h-72 w-full" />
                    <Skeleton className="h-72 w-full lg:col-span-2" />
                </div>
            </div>
        );
    }

    if (!tombola) {
        return (
            <div className="space-y-6">
                <PageHeader title="Tirage de la tombola" actions={back} />
                <Panel>
                    <EmptyState
                        icon={DiceIcon}
                        title="La tombola n’a pas pu être chargée"
                        description={error ?? 'Ses informations ne sont pas disponibles.'}
                        action={<Button size="lg" onClick={() => void fetchTombola()}>Réessayer</Button>}
                    />
                </Panel>
            </div>
        );
    }

    // Derived states based on the MAIN tombola object
    const canDraw = tombola.status === TombolaStatus.OPEN || tombola.status === TombolaStatus.DRAWING;
    const alreadyDrawn = tombola.status === TombolaStatus.CLOSED && tombola.winners && tombola.winners.length > 0;
    const label = monthLabel(tombola.month, tombola.year);
    const machineVisible = drawingState === 'numbers_loaded' || drawingState === 'drawing' || drawingState === 'revealing' || drawingState === 'done';
    const busy = drawingState === 'drawing' || drawingState === 'revealing';

    const winnerName = (w: Winner) => {
        const d = winnerUserDetails.get(w.userId);
        if (d) return `${d.name}${d.country ? ` (${d.country})` : ''}`;
        if (isLoadingUserDetails) return 'Chargement…';
        return null;
    };

    const ball = (num: number, size: 'md' | 'sm' = 'md') => (
        <span
            className={`flex shrink-0 items-center justify-center rounded-full ${size === 'md' ? 'h-8 w-8' : 'h-6 w-6'}`}
            style={{ background: ballColor(allTicketNumbers.indexOf(num)) }}
        >
            <span className={`flex items-center justify-center rounded-full bg-white font-bold text-black ${size === 'md' ? 'h-5 w-5 text-[10px]' : 'h-4 w-4 text-[8px]'}`}>
                {num}
            </span>
        </span>
    );

    return (
        <div className="space-y-6">
            <PageHeader
                title={`Tirage — ${monthTitle(tombola.month, tombola.year)}`}
                description="Le tirage choisit les gagnants parmi les tickets vendus. Il est définitif et les gagnants sont prévenus par notification."
                actions={(
                    <>
                        {back}
                        {!alreadyDrawn && canDraw && (
                            <Can module="tombola" write>
                                <Button variant="primary" size="lg" className="w-full sm:w-auto" onClick={openConfirmation} disabled={isDrawButtonDisabled} loading={drawingState === 'drawing'}>
                                    <HugeiconsIcon icon={DiceIcon} size={18} aria-hidden="true" />
                                    Lancer le tirage
                                </Button>
                            </Can>
                        )}
                    </>
                )}
            />

            {drawingState === 'error' && (drawError || error) && <Notice tone="danger">{drawError ?? error}</Notice>}
            {!alreadyDrawn && canDraw && tombola.lastTicketNumber === 0 && (
                <Notice tone="warning">Aucun ticket vendu : le tirage ne donnera aucun gagnant.</Notice>
            )}
            {!alreadyDrawn && !canDraw && (
                <Notice tone="info">
                    Cette tombola est {tombola.status === TombolaStatus.CLOSED ? 'fermée' : 'dans un état inattendu'} sans gagnant :
                    le service ne tire qu’une tombola ouverte. Rouvrez-la depuis la liste des tombolas pour lancer le tirage.
                </Notice>
            )}
            {alreadyDrawn && <Notice tone="success">Les gagnants de cette tombola ont déjà été tirés.</Notice>}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Panel className="self-start">
                    <PanelHeader title="Tombola" description={label} />
                    <PanelBody>
                        <DetailList items={[
                            ['Statut', <StatusBadge status={tombola.status} map={TOMBOLA_STATUS} />],
                            ['Tickets vendus', <span className="tabular-nums">{formatNumber(tombola.lastTicketNumber ?? 0)}</span>],
                            ['Numéros chargés', drawingState === 'loading_numbers' || isLoadingTicketNumbers ? 'Chargement…' : <span className="tabular-nums">{formatNumber(allTicketNumbers.length)}</span>],
                            ['Début', formatDateTime(tombola.startDate)],
                            ['Tirage', tombola.drawDate ? formatDateTime(tombola.drawDate) : 'Pas encore tiré'],
                        ]} />
                    </PanelBody>
                </Panel>

                <div className="space-y-4 lg:col-span-2">
                    <Panel>
                        <PanelHeader title="Machine de tirage" description={
                            drawingState === 'drawing' ? 'Tirage des gagnants…'
                                : drawingState === 'revealing' ? 'Révélation des gagnants…'
                                    : drawingState === 'done' ? (backendWinners.length ? 'Tirage terminé.' : 'Tirage terminé. Aucun gagnant.')
                                        : drawingState === 'loading_numbers' ? 'Chargement des tickets…'
                                            : canDraw ? 'Prête : les boules sont les tickets vendus.' : 'Les boules sont les tickets vendus.'
                        } />
                        <PanelBody className="flex flex-col items-center">
                            {drawingState === 'loading_numbers' && <Skeleton className="h-64 w-64 rounded-full" />}
                            {drawingState === 'error' && drawError && !machineVisible && <p className="py-16 text-sm text-danger">{drawError}</p>}
                            {machineVisible && (
                                <motion.div
                                    className={`relative mb-2 flex h-64 w-64 max-w-full items-center justify-center overflow-hidden bg-surface-2 ${busy ? 'animate-pulse' : ''}`}
                                    style={{ clipPath: 'polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)' }}
                                    aria-label={`Machine de tirage : ${formatNumber(allTicketNumbers.length)} tickets`}
                                    role="img"
                                >
                                    {allTicketNumbers.length > 0 ? (
                                        allTicketNumbers.slice(0, 100).map((num, index) => {
                                            // Winning balls leave the machine once the draw is done
                                            if (drawingState === 'done' && revealedEjectedBalls.includes(num)) return null;
                                            const pos = ballPositions[index];
                                            return (
                                                <motion.div
                                                    key={`ball-${num}`}
                                                    className="absolute flex h-8 w-8 items-center justify-center rounded-full"
                                                    style={{
                                                        top: `${pos.top}%`,
                                                        left: `${pos.left}%`,
                                                        transform: 'translate(-50%, -50%)',
                                                        background: ballColor(index),
                                                        visibility: ejectedBallNumber === num ? 'hidden' : 'visible',
                                                    }}
                                                    variants={ballVariants}
                                                    initial="initial"
                                                    animate={busy ? 'drawing' : 'animate'}
                                                    custom={index}
                                                >
                                                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-bold text-black">{num}</span>
                                                </motion.div>
                                            );
                                        })
                                    ) : (
                                        drawingState === 'numbers_loaded' && <p className="text-sm text-fg-muted">Aucun ticket vendu</p>
                                    )}
                                    <AnimatePresence>
                                        {ejectedBallNumber !== null && (
                                            <motion.div
                                                key={`ejected-${ejectedBallNumber}`}
                                                className="absolute z-20 flex h-8 w-8 items-center justify-center rounded-full"
                                                style={{ top: '50%', left: '50%', background: ballColor(allTicketNumbers.indexOf(ejectedBallNumber)) }}
                                                variants={ejectedBallVariants}
                                                initial="initial"
                                                exit="exit"
                                            >
                                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-bold text-black">{ejectedBallNumber}</span>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </motion.div>
                            )}
                            {allTicketNumbers.length > 100 && machineVisible && (
                                <p className="text-xs text-fg-muted">100 boules affichées sur {formatNumber(allTicketNumbers.length)} : le tirage porte sur tous les tickets.</p>
                            )}
                        </PanelBody>
                    </Panel>

                    <Panel>
                        <PanelHeader
                            title={(
                                <span className="flex items-center gap-2">
                                    <HugeiconsIcon icon={Award01Icon} size={18} aria-hidden="true" className="text-fg-muted" />
                                    {drawingState === 'revealing' ? 'Révélation des gagnants…' : (drawingState === 'done' && animatedWinners.length > 0) ? 'Gagnants' : 'Gagnants'}
                                </span>
                            )}
                            description={alreadyDrawn ? 'Résultat définitif.' : undefined}
                        />
                        <PanelBody>
                            {drawingState !== 'revealing' && drawingState !== 'done' && (
                                <p className="py-6 text-center text-sm text-fg-muted">Les gagnants apparaîtront ici après le tirage.</p>
                            )}
                            {(drawingState === 'revealing' || (drawingState === 'done' && animatedWinners.length > 0)) && (
                                <motion.ul layout className="divide-y divide-line rounded-panel border border-line">
                                    <AnimatePresence>
                                        {animatedWinners.map((winner, index) => {
                                            if (!winner) return null;
                                            const name = winnerName(winner);
                                            return (
                                                <motion.li
                                                    layout
                                                    key={winner.rank}
                                                    initial={{ opacity: 0, x: -50 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    exit={{ opacity: 0 }}
                                                    transition={{ duration: 0.5, delay: index * 0.1 }}
                                                    className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
                                                >
                                                    <span className={`inline-flex w-fit items-center rounded-md px-2 py-0.5 text-sm font-semibold ${winner.rank === 1 ? 'bg-warning-soft text-fg' : 'bg-surface-3 text-fg'}`}>
                                                        Rang {winner.rank}
                                                    </span>
                                                    <span className="min-w-0 flex-1 text-sm text-fg">
                                                        <span className="font-medium"><Prize value={winner.prize} /></span>
                                                        <span className="text-fg-muted"> · ticket n° <span className="tabular-nums text-fg">{winner.winningTicketNumber}</span></span>
                                                    </span>
                                                    <span className="flex items-center gap-2 text-sm text-fg-muted sm:justify-end">
                                                        {name ?? <CopyId value={winner.userId} label="Copier l’identifiant du gagnant" />}
                                                        {drawingState === 'done' && revealedEjectedBalls[index] !== undefined && ball(revealedEjectedBalls[index], 'sm')}
                                                    </span>
                                                </motion.li>
                                            );
                                        })}
                                    </AnimatePresence>
                                </motion.ul>
                            )}
                            {drawingState === 'done' && animatedWinners.length === 0 && backendWinners.length === 0 && (
                                <p className="py-6 text-center text-sm text-fg-muted">Aucun gagnant pour cette tombola.</p>
                            )}
                        </PanelBody>
                    </Panel>
                </div>
            </div>

            <ConfirmDialog
                options={isConfirmModalOpen ? {
                    title: `Lancer le tirage de ${label} ?`,
                    description: `Le tirage choisit les gagnants parmi ${formatNumber(allTicketNumbers.length)} tickets. Il est définitif et les gagnants sont prévenus par notification.`,
                    confirmLabel: 'Lancer le tirage',
                    tone: 'primary',
                    onConfirm: () => { void handlePerformDraw(); },
                } : null}
                onClose={closeConfirmation}
            />
        </div>
    );
}

export default TombolaDrawPage;
