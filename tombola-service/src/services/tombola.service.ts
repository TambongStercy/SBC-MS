import { Types, SortOrder } from 'mongoose';
// import { nanoid } from 'nanoid'; // Import nanoid
import { tombolaMonthRepository } from '../database/repositories/tombolaMonth.repository';
import { tombolaTicketRepository } from '../database/repositories/tombolaTicket.repository';
import { paymentService } from './clients/payment.service.client';
import logger from '../utils/logger';
import config from '../config';
import { AppError } from '../utils/errors'; // Assuming AppError will be created
import { ITombolaTicket } from '../database/models/tombolaTicket.model';
import { TombolaStatus } from '../database/models/tombolaMonth.model'; // Import enum
import { ITombolaMonth, IWinner } from '../database/models/tombolaMonth.model'; // Import interface and IWinner
import { notificationService } from './clients/notification.service.client'; // Import notification client
import { nanoid } from 'nanoid';
import { PopulatedTombolaTicket, tombolaTicketRepository as ticketRepository } from '../database/repositories/tombolaTicket.repository';
import { userServiceClient, UserDetails } from './clients/user.service.client'; // <-- Import UserDetails
import { FilterQuery } from 'mongoose';

const log = logger.getLogger('TombolaService');

// Define the structure for the response when initiating purchase
interface BuyTicketResponse {
    message: string;
    tombolaMonthId: string;
    provisionalTicketId: string;
    paymentIntentId?: string; // Make optional
    paymentSessionId: string;
    checkoutUrl?: string;    // Keep as optional (maps from paymentPageUrl)
    clientSecret?: string;   // Keep as optional
}

// Define prizes
const PRIZES = {
    1: 'Bike',
    2: 'Phone',
    3: '100k FCFA',
};

// Define a type for the enriched ticket data
interface EnrichedTombolaTicket extends PopulatedTombolaTicket {
    userName?: string;
    userPhoneNumber?: string;
}

class TombolaService {

    /**
     * Initiates the purchase process for a tombola ticket.
     * Finds the current open tombola, generates a ticket ID, creates a payment intent.
     * Does NOT create the TombolaTicket record yet (that happens after payment).
     *
     * @param userId - The ID of the user purchasing the ticket.
     * @returns Information needed to proceed with payment.
     */
    async initiateTicketPurchase(userId: string): Promise<BuyTicketResponse> {
        log.info(`Initiating ticket purchase for user: ${userId}`);

        // 1. Find the current open TombolaMonth
        const currentTombola = await tombolaMonthRepository.findCurrentOpen();
        if (!currentTombola) {
            log.warn('Ticket purchase attempt failed: No open tombola found.');
            throw new AppError('There is no tombola currently open for ticket purchases.', 404);
        }

        // Optional: Check if user has reached a purchase limit for this month (if applicable)
        // const userTicketCount = await tombolaTicketRepository.countByUserForMonth(userId, currentTombola._id);
        // if (userTicketCount >= MAX_TICKETS_PER_USER) {
        //     throw new AppError('You have reached the maximum number of tickets for this month\'s tombola.', 400);
        // }

        // 2. Generate a unique provisional Ticket ID
        // We generate it now to pass in metadata, but only save the ticket if payment succeeds.
        const provisionalTicketId = nanoid(12); // Generate a 12-character unique ID
        log.debug(`Generated provisional ticket ID: ${provisionalTicketId}`);

        // 3. Initiate Payment Intent with Payment Service
        const ticketPrice = config.tombolaTicketPrice;
        try {
            // Call the refactored createIntent with specific details
            const paymentIntentData = await paymentService.createIntent({
                userId: userId,
                amount: ticketPrice,
                currency: 'XAF', // Assuming XAF
                paymentType: 'TOMBOLA_TICKET', // Specific type
                metadata: { // Essential metadata for callback
                    tombolaMonthId: currentTombola._id.toString(),
                    userId: userId,
                    provisionalTicketId: provisionalTicketId,
                    originatingService: 'tombola-service', // Identify originating service
                    callbackPath: `${config.selfBaseUrl}/api/tombolas/webhooks/payment-confirmation` // Use full URL
                },
            });

            if (!paymentIntentData || !paymentIntentData.sessionId) {
                log.error('Failed to get payment session ID from payment service client');
                throw new AppError('Could not initialize payment for the ticket.', 500);
            }

            log.info(`Payment intent initiated for user ${userId}, ticket ${provisionalTicketId}. Session ID: ${paymentIntentData.sessionId}`);

            // 4. Return payment details to the user/frontend
            return {
                message: 'Payment intent created. Please complete payment.',
                tombolaMonthId: currentTombola._id.toString(),
                provisionalTicketId: provisionalTicketId,
                paymentIntentId: paymentIntentData.paymentIntentId, // Assign directly (now allowed)
                paymentSessionId: paymentIntentData.sessionId, // Our tracking ID
                checkoutUrl: paymentIntentData.paymentPageUrl, // Use paymentPageUrl
                clientSecret: paymentIntentData.clientSecret,
            };

        } catch (error) {
            log.error(`Error during payment intent creation for user ${userId}:`, error);
            // Re-throw AppErrors or wrap others
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError('Failed to initiate payment for tombola ticket.', 500);
        }
    }

    /**
     * Handles the successful payment confirmation (e.g., from a webhook).
     * Creates the actual TombolaTicket record.
     *
     * @param paymentSessionId - The session ID from the payment intent.
     * @param paymentMetadata - Metadata received from the payment confirmation (should contain userId, tombolaMonthId, provisionalTicketId).
     * @returns The newly created and populated TombolaTicket document.
     */
    async confirmTicketPurchase(paymentSessionId: string, paymentMetadata: any): Promise<PopulatedTombolaTicket> {
        log.info(`Confirming ticket purchase for payment session: ${paymentSessionId}`);

        // 1. Validate Metadata
        const { userId, tombolaMonthId, provisionalTicketId } = paymentMetadata || {};
        if (!userId || !tombolaMonthId || !provisionalTicketId) {
            log.error('Ticket purchase confirmation failed: Missing required metadata from payment event.', { paymentSessionId, paymentMetadata });
            throw new AppError('Invalid payment confirmation data received.', 400);
        }

        // 2. Check if ticket already exists (idempotency)
        const existingTicket = await ticketRepository.findOne({ ticketId: provisionalTicketId });
        if (existingTicket) {
            log.warn(`Ticket purchase confirmation ignored: Ticket ${provisionalTicketId} already exists (idempotency check).`, { paymentSessionId });
            return existingTicket;
        }

        // 3. Verify the TombolaMonth still exists and is OPEN (or DRAWING)
        const tombolaMonth = await tombolaMonthRepository.findById(tombolaMonthId);
        if (!tombolaMonth || (tombolaMonth.status !== 'open' && tombolaMonth.status !== 'drawing')) { // Adjust status check as needed
            log.error('Ticket purchase confirmation failed: Tombola month not found or no longer accepting tickets.', { tombolaMonthId, status: tombolaMonth?.status });
            throw new AppError('Tombola is no longer open for ticket purchases.', 400);
        }

        // 4. Get the next sequential ticket number for this month (Atomic operation)
        let ticketNumber: number;
        try {
            ticketNumber = await tombolaMonthRepository.incrementAndGetTicketNumber(tombolaMonthId);
        } catch (error) {
            log.error('Failed to get next ticket number during purchase confirmation:', { tombolaMonthId, error });
            // This is critical, as payment succeeded but we can't assign a number.
            throw new AppError('Failed to generate ticket number. Please contact support.', 500);
        }

        // 5. Create the TombolaTicket record
        try {
            const newTicketData: Partial<ITombolaTicket> = {
                userId: new Types.ObjectId(userId),
                tombolaMonthId: new Types.ObjectId(tombolaMonthId),
                ticketId: provisionalTicketId, // Keep the unique ID
                ticketNumber: ticketNumber,      // Assign the sequential number
                purchaseTimestamp: new Date(), // Record actual confirmation time
                paymentIntentId: paymentSessionId, // Link to the payment session
            };
            const createdTicket = await ticketRepository.create(newTicketData);
            log.info(`Successfully confirmed and created TombolaTicket ${createdTicket.ticketId} (Number: ${ticketNumber}) for user ${userId}`);

            // 6. Fetch the created ticket *with population* to return it
            const populatedTicket = await ticketRepository.findOne({ _id: createdTicket._id });
            if (!populatedTicket) {
                // This should ideally not happen if create/findOne succeeded
                log.error(`Failed to fetch newly created ticket ${createdTicket._id} with population.`);
                throw new AppError('Failed to retrieve ticket details after creation.', 500);
            }

            return populatedTicket; // Type is now guaranteed PopulatedTombolaTicket

        } catch (error) {
            log.error(`Failed to create TombolaTicket record after payment confirmation:`, { userId, tombolaMonthId, provisionalTicketId, error });
            log.error(`CRITICAL FAILURE: Payment session ${paymentSessionId} succeeded, but failed to create TombolaTicket ${provisionalTicketId} for user ${userId} in tombola ${tombolaMonthId}. Manual intervention likely required. Error: ${(error as Error).message}`);
            // This is a critical error - payment succeeded but ticket wasn't recorded.
            // Requires manual investigation or retry mechanism.
            // Consider emitting a specific event for monitoring/alerting systems here.
            throw new AppError('Failed to record ticket purchase after successful payment. Please contact support.', 500); // User-friendly message
            // throw new AppError('Failed to record ticket purchase after successful payment.', 500);
        }
    }

    /**
     * Performs the winner draw for a given TombolaMonth.
     * 
     * @param tombolaMonthId - The ID of the TombolaMonth to draw winners for.
     * @returns The updated TombolaMonth document with winners.
     */
    async drawWinners(tombolaMonthId: string): Promise<ITombolaMonth> {
        log.info(`Starting winner draw for TombolaMonth: ${tombolaMonthId}`);

        // 1. Fetch and Validate TombolaMonth
        const tombolaMonth = await tombolaMonthRepository.findById(tombolaMonthId);
        if (!tombolaMonth) {
            log.error(`Draw failed: TombolaMonth ${tombolaMonthId} not found.`);
            throw new AppError('Tombola month not found.', 404);
        }
        // Ensure it's ready for drawing (e.g., status is OPEN or DRAWING - decide policy)
        // Let's assume we can only draw if it's explicitly marked for drawing or still open
        if (tombolaMonth.status !== TombolaStatus.OPEN && tombolaMonth.status !== TombolaStatus.DRAWING) {
            log.warn(`Draw attempt failed: TombolaMonth ${tombolaMonthId} is not in OPEN or DRAWING status (current: ${tombolaMonth.status}).`);
            throw new AppError(`Tombola month is not ready for drawing. Current status: ${tombolaMonth.status}`, 400);
        }
        if (tombolaMonth.winners && tombolaMonth.winners.length > 0) {
            log.warn(`Draw attempt failed: TombolaMonth ${tombolaMonthId} already has winners.`);
            throw new AppError('Winners have already been drawn for this tombola month.', 400);
        }

        // 2. Fetch All Tickets for the Month (without population for draw efficiency)
        const tickets = await tombolaTicketRepository.findByMonth(tombolaMonthId); // Returns ITombolaTicket[] without population

        if (!tickets || tickets.length === 0) {
            log.warn(`Draw failed: No tickets found for TombolaMonth ${tombolaMonthId}. Closing without winners.`);
            // Close the tombola without winners
            const updatedMonth = await tombolaMonthRepository.findByIdAndUpdate(tombolaMonthId, {
                status: TombolaStatus.CLOSED,
                drawDate: new Date(),
                endDate: tombolaMonth.endDate || new Date(), // Set end date if not already set
            });
            if (!updatedMonth) throw new AppError('Failed to close tombola month after finding no tickets', 500);
            return updatedMonth;
        }
        log.info(`Found ${tickets.length} tickets for TombolaMonth ${tombolaMonthId}.`);

        // 3. Apply Anti-Consecutive-Win Rule: Exclude previous month's winners
        const previousMonthWinners = tombolaMonth.previousMonthWinners || [];
        const excludedUserIds = new Set(previousMonthWinners.map(id => id.toString()));

        if (excludedUserIds.size > 0) {
            log.info(`Excluding ${excludedUserIds.size} previous month winners from draw (anti-consecutive-win rule)`);
        }

        const eligibleTickets = tickets.filter(ticket =>
            !excludedUserIds.has(ticket.userId.toString())
        );

        if (eligibleTickets.length === 0) {
            log.warn(`Draw failed: No eligible tickets after applying exclusion rules for TombolaMonth ${tombolaMonthId}.`);
            const updatedMonth = await tombolaMonthRepository.findByIdAndUpdate(tombolaMonthId, {
                status: TombolaStatus.CLOSED,
                drawDate: new Date(),
                endDate: tombolaMonth.endDate || new Date(),
            });
            if (!updatedMonth) throw new AppError('Failed to close tombola month after filtering tickets', 500);
            return updatedMonth;
        }

        log.info(`${eligibleTickets.length} eligible tickets after exclusions (filtered from ${tickets.length} total)`);

        // 4. Build Weighted Ticket Pool
        const weightedPool: Array<{ ticket: ITombolaTicket; weight: number }> = eligibleTickets.map(ticket => ({
            ticket,
            weight: ticket.weight || 1.0 // Default to 1.0 for backward compatibility
        }));

        // 5. Select Winners Using Weighted Probability, Ensuring Unique Users
        const winners: { userId: Types.ObjectId, prize: string, rank: number, winningTicketNumber: number }[] = [];
        const numberOfPrizes = Math.min(eligibleTickets.length, 3); // Max 3 prizes
        const selectedUserIds = new Set<string>();

        for (let rank = 1; rank <= numberOfPrizes; rank++) {
            // Filter out already-won users
            const currentEligiblePool = weightedPool.filter(
                ({ ticket }) => !selectedUserIds.has(ticket.userId.toString())
            );

            if (currentEligiblePool.length === 0) {
                log.warn(`Not enough unique users for rank ${rank}`);
                break;
            }

            // Calculate total weight
            const totalWeight = currentEligiblePool.reduce((sum, { weight }) => sum + weight, 0);

            // Weighted random selection
            let random = Math.random() * totalWeight;
            let selectedTicket: ITombolaTicket | null = null;

            for (const { ticket, weight } of currentEligiblePool) {
                random -= weight;
                if (random <= 0) {
                    selectedTicket = ticket;
                    break;
                }
            }

            // Fallback to last ticket if rounding issues
            if (!selectedTicket) {
                selectedTicket = currentEligiblePool[currentEligiblePool.length - 1].ticket;
            }

            // Record winner
            const userIdString = selectedTicket.userId.toString();
            selectedUserIds.add(userIdString);
            winners.push({
                userId: selectedTicket.userId,
                prize: PRIZES[rank as keyof typeof PRIZES],
                rank: rank,
                winningTicketNumber: selectedTicket.ticketNumber
            });

            log.info(`Rank ${rank} winner: User ${userIdString}, Ticket ${selectedTicket.ticketNumber}, Weight ${selectedTicket.weight || 1.0}`);
        }

        log.info('Selected winners:', winners.map(w => ({
            rank: w.rank,
            userId: w.userId,
            prize: w.prize,
            ticketNumber: w.winningTicketNumber // Log ticket number
        })));

        // 5. Update TombolaMonth with Winners and Status
        const updatePayload = {
            status: TombolaStatus.CLOSED,
            drawDate: new Date(),
            endDate: tombolaMonth.endDate || new Date(), // Ensure endDate is set
            winners: winners, // Add the winner array
        };

        const updatedTombolaMonth = await tombolaMonthRepository.findByIdAndUpdate(tombolaMonthId, updatePayload);

        if (!updatedTombolaMonth) {
            log.error(`Failed to update TombolaMonth ${tombolaMonthId} with winners.`);
            // This is problematic - draw happened but wasn't saved.
            throw new AppError('Failed to save winner information after draw.', 500);
        }

        log.info(`Successfully drew winners and closed TombolaMonth ${tombolaMonthId}.`);

        // --- 6. Trigger Notifications --- 
        // Use updatedTombolaMonth which definitely has winners if we reached here
        this.notifyWinners(updatedTombolaMonth).catch(err => {
            // Log error but don't fail the overall draw process if notifications fail
            log.error(`Error occurred during winner notification process for TombolaMonth ${tombolaMonthId}:`, err);
        });
        // --- End Notification Trigger ---

        return updatedTombolaMonth;
    }

    /**
     * Sends notifications to winners asynchronously.
     */
    private async notifyWinners(tombolaMonth: ITombolaMonth): Promise<void> {
        if (!tombolaMonth.winners || tombolaMonth.winners.length === 0) {
            log.debug('No winners to notify.');
            return;
        }

        log.info(`Initiating notifications for ${tombolaMonth.winners.length} winners of Tombola ${tombolaMonth.year}-${tombolaMonth.month}`);

        const notificationPromises = tombolaMonth.winners.map(winner => {
            const message = `Congratulations! You won the ${winner.prize} (Rank ${winner.rank}) in the ${tombolaMonth.year}-${String(tombolaMonth.month).padStart(2, '0')} Tombola!`;

            // Send notification via notification service
            return notificationService.createInternalNotification({
                userId: winner.userId.toString(),
                type: 'TOMBOLA_WINNER', // Specific type for categorization
                channel: 'PUSH', // Or 'EMAIL', 'SMS', let notification service decide preference
                data: {
                    title: 'You Won the Tombola!',
                    body: message,
                    relatedData: { // Add context
                        tombolaMonthId: tombolaMonth._id.toString(),
                        year: tombolaMonth.year,
                        month: tombolaMonth.month,
                        prize: winner.prize,
                        rank: winner.rank,
                    }
                }
            }).catch(err => { // Catch individual notification errors
                log.error(`Failed to send notification to winner ${winner.userId} for prize ${winner.prize}:`, err);
                // Optionally track failed notifications for retry
            });
        });

        // Wait for all notification requests to be sent (or fail)
        await Promise.allSettled(notificationPromises);
        log.info(`Finished sending notification requests for TombolaMonth ${tombolaMonth._id}`);
    }

    /**
     * Retrieves a list of past (closed) Tombola months.
     * TODO: Add pagination
     */
    async getPastTombolas(limit: number = 10, skip: number = 0): Promise<ITombolaMonth[]> {
        log.info('Fetching past tombola months');
        try {
            const query = { status: TombolaStatus.CLOSED };
            const sort = { year: -1 as SortOrder, month: -1 as SortOrder };
            const tombolas = await tombolaMonthRepository.find(query, limit, skip, sort);
            log.info(`Found ${tombolas.length} closed tombola months.`);
            return tombolas;
        } catch (error) {
            log.error('Error fetching past tombola months:', error);
            throw new AppError('Could not retrieve past tombolas.', 500);
        }
    }

    /**
     * Retrieves the currently open Tombola month, if any.
     */
    async getCurrentOpenTombola(): Promise<ITombolaMonth | null> {
        log.info('Fetching currently open tombola month');
        try {
            const tombola = await tombolaMonthRepository.findCurrentOpen();
            if (tombola) {
                log.info(`Found open tombola: ${tombola.year}-${tombola.month}`);
            } else {
                log.info('No tombola currently open.');
            }
            return tombola;
        } catch (error) {
            log.error('Error fetching current open tombola month:', error);
            throw new AppError('Could not retrieve the current tombola.', 500);
        }
    }

    /**
     * Retrieves a list of all Tombola months for admin purposes.
     * Includes pagination.
     */
    async listAllTombolasAdmin(limit: number = 20, skip: number = 0): Promise<{ tombolas: ITombolaMonth[], totalCount: number }> {
        log.info(`Admin request: Fetching all tombola months (limit: ${limit}, skip: ${skip})`);
        try {
            const query = {}; // No filter for admin view
            const sort = { year: -1 as SortOrder, month: -1 as SortOrder };
            const tombolas = await tombolaMonthRepository.find(query, limit, skip, sort);
            const totalCount = await tombolaMonthRepository.count(query);
            log.info(`Admin request: Found ${tombolas.length} of ${totalCount} total tombola months.`);
            return { tombolas, totalCount };
        } catch (error) {
            log.error('Admin request: Error fetching all tombola months:', error);
            throw new AppError('Could not retrieve tombola list for admin.', 500);
        }
    }

    /**
     * Retrieves a list of tickets for a specific Tombola month for admin purposes.
     * Includes pagination and enriches tickets with user name and phone number.
     * Returns populated ticket data including month and year.
     */
    async listTicketsForMonthAdmin(
        tombolaMonthId: string,
        limit: number = 50,
        skip: number = 0,
        searchQuery?: string // Add searchQuery parameter
    ): Promise<{ tickets: EnrichedTombolaTicket[], totalCount: number }> {
        log.info(`Admin request: Fetching tickets for month ${tombolaMonthId} (limit: ${limit}, skip: ${skip}, search: ${searchQuery || 'none'})`);
        try {
            const query: FilterQuery<ITombolaTicket> = { tombolaMonthId: new Types.ObjectId(tombolaMonthId) };
            const sort = { purchaseTimestamp: 1 as SortOrder };
            let matchingUserIds: string[] | null = null;

            // --- Search User Service First if searchQuery exists ---
            if (searchQuery && searchQuery.trim() !== '') {
                log.debug(`Searching user service for term: ${searchQuery}`);
                try {
                    matchingUserIds = await userServiceClient.findUserIdsBySearchTerm(searchQuery.trim());
                    if (matchingUserIds === null || matchingUserIds.length === 0) {
                        log.info(`No users found matching search term '${searchQuery}'. Returning empty results.`);
                        return { tickets: [], totalCount: 0 }; // No users match, so no tickets will match
                    }
                    log.debug(`Found ${matchingUserIds.length} potential user IDs matching search.`);
                    query.userId = { $in: matchingUserIds.map(id => new Types.ObjectId(id)) }; // Add user IDs to the ticket query
                } catch (userSearchError) {
                    log.error(`Error searching users in user-service for term '${searchQuery}':`, userSearchError);
                    // If user search fails, maybe return an error or empty results?
                    // Throwing an error seems more appropriate here as the search couldn't be performed.
                    throw new AppError('Failed to search users to filter tickets.', 500);
                }
            }
            // --- End User Search ---

            // Fetch total count *using the final query* (including user filter if applied)
            const totalCount = await tombolaTicketRepository.count(query);

            // Fetch tickets with pagination *using the final query*
            const tickets = await tombolaTicketRepository.find(query, limit, skip, sort);

            let enrichedTickets: EnrichedTombolaTicket[] = tickets.map(t => ({ ...t })); // Already lean objects

            if (tickets.length > 0) {
                // Enrich only the paginated tickets
                const userIdsToFetch = [...new Set(tickets.map(ticket => ticket.userId.toString()))];
                log.debug(`Fetching details for ${userIdsToFetch.length} unique users in the current page.`);
                try {
                    const users = await userServiceClient.getUsersByIds(userIdsToFetch);
                    const userMap = new Map<string, { name: string; phoneNumber?: string }>();
                    users.forEach((user: UserDetails) => {
                        if (user && user._id) {
                            userMap.set(user._id.toString(), { name: user.name, phoneNumber: user.phoneNumber });
                        }
                    });
                    log.debug(`Received details for ${userMap.size} users from user-service.`);
                    enrichedTickets = enrichedTickets.map(ticket => {
                        const userDetails = userMap.get(ticket.userId.toString());
                        return {
                            ...ticket,
                            userName: userDetails?.name,
                            userPhoneNumber: userDetails?.phoneNumber !== undefined ? String(userDetails.phoneNumber) : undefined
                        };
                    });
                } catch (userServiceError) {
                    log.error(`Failed to fetch or map user details from user-service for ticket list (Month: ${tombolaMonthId}):`, userServiceError);
                    // Proceed without enrichment, but log the error.
                }
            }

            log.info(`Admin request: Returning ${enrichedTickets.length} enriched tickets of ${totalCount} total for month ${tombolaMonthId}.`);
            return { tickets: enrichedTickets, totalCount };

        } catch (error) {
            log.error(`Admin request: Error fetching tickets for month ${tombolaMonthId}:`, error);
            // console.error(error); // Keep console.error temporarily for detailed stack trace
            // If it's already an AppError, rethrow it, otherwise wrap it
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError('Could not retrieve ticket list for admin.', 500);
        }
    }

    /**
     * Retrieves the winners for a specific, closed Tombola month.
     *
     * @param tombolaMonthId - The ID of the TombolaMonth.
     * @returns The array of winner objects.
     */
    async getTombolaWinners(tombolaMonthId: string): Promise<IWinner[]> {
        log.info(`Fetching winners for TombolaMonth: ${tombolaMonthId}`);

        // 1. Fetch the TombolaMonth
        const tombolaMonth = await tombolaMonthRepository.findById(tombolaMonthId);
        if (!tombolaMonth) {
            log.warn(`Winner fetch failed: TombolaMonth ${tombolaMonthId} not found.`);
            throw new AppError('Tombola month not found.', 404);
        }

        // 2. Check if the tombola is closed
        if (tombolaMonth.status !== TombolaStatus.CLOSED) {
            log.warn(`Winner fetch failed: TombolaMonth ${tombolaMonthId} is not closed (status: ${tombolaMonth.status}).`);
            throw new AppError('Winners for this tombola month have not been finalized yet.', 400);
        }

        // 3. Return the winners array
        log.info(`Successfully retrieved ${tombolaMonth.winners.length} winners for TombolaMonth ${tombolaMonthId}.`);
        // We need to explicitly convert the Mongoose DocumentArray subdocuments to plain objects if needed by the caller
        // Using .toObject() on each subdocument, or relying on lean() in the repository fetch
        // Since findById used lean(), this should be okay. If not, map winners: tombolaMonth.winners.map(w => w.toObject())
        return tombolaMonth.winners;
    }

    /**
     * Creates a new TombolaMonth for the given month and year.
     * Ensures only one tombola is OPEN at a time.
     *
     * @param month - The month number (1-12).
     * @param year - The year.
     * @returns The newly created TombolaMonth document.
     */
    async createTombolaMonth(month: number, year: number): Promise<ITombolaMonth> {
        log.info(`Admin request: Attempting to create TombolaMonth for ${year}-${month}`);

        // --- Input Validation ---
        if (month < 1 || month > 12) {
            throw new AppError('Invalid month provided (must be 1-12).', 400);
        }
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1; // JS month is 0-11

        // Prevent creating for future months/years
        if (year > currentYear || (year === currentYear && month > currentMonth)) {
            log.warn(`Admin request failed: Attempted to create TombolaMonth for future date ${year}-${month}.`);
            throw new AppError(`Cannot create a tombola for a future date (requested: ${year}-${month}, current: ${currentYear}-${currentMonth}).`, 400);
        }

        // Validate past year range (optional, adjust as needed)
        const oldestAllowedYear = currentYear - 5; // Example: Allow up to 5 years in the past
        if (year < oldestAllowedYear) {
            throw new AppError(`Invalid year provided (Year must be ${oldestAllowedYear} or newer).`, 400);
        }
        // --- End Input Validation ---

        // Check if a TombolaMonth already exists for this month/year
        const existing = await tombolaMonthRepository.findOne({ month, year });
        if (existing) {
            log.warn(`Admin request failed: TombolaMonth for ${year}-${month} already exists.`);
            throw new AppError(`A tombola for ${year}-${month} already exists.`, 409); // 409 Conflict
        }

        // Close any currently open tombolas *before* creating the new one as OPEN
        await tombolaMonthRepository.closeAllOpenTombolas();

        // Create the new TombolaMonth
        try {
            const newTombolaData: Partial<ITombolaMonth> = {
                month,
                year,
                status: TombolaStatus.OPEN, // Set new one to OPEN
                startDate: new Date(), // Starts now by default
                winners: [] as unknown as Types.DocumentArray<IWinner>,
            };
            const createdTombola = await tombolaMonthRepository.create(newTombolaData);
            log.info(`Admin request successful: Created TombolaMonth ${createdTombola._id} for ${year}-${month} and set status to OPEN.`);
            return createdTombola;
        } catch (error) {
            log.error(`Admin request failed: Error creating TombolaMonth for ${year}-${month}:`, error);
            if (error instanceof Error && (error as any).code === 11000) {
                throw new AppError(`A tombola for ${year}-${month} already exists (database constraint).`, 409);
            }
            throw new AppError('Failed to create the new tombola month.', 500);
        }
    }

    /**
     * Updates the status of a TombolaMonth (OPEN or CLOSED).
     * If setting to OPEN, ensures all others are CLOSED first.
     *
     * @param tombolaMonthId - The ID of the TombolaMonth to update.
     * @param newStatus - The desired new status (OPEN or CLOSED).
     * @returns The updated TombolaMonth document.
     */
    async setTombolaStatus(tombolaMonthId: string, newStatus: TombolaStatus.OPEN | TombolaStatus.CLOSED): Promise<ITombolaMonth> {
        log.info(`Service: Setting status for TombolaMonth ${tombolaMonthId} to ${newStatus}`);

        if (newStatus !== TombolaStatus.OPEN && newStatus !== TombolaStatus.CLOSED) {
            throw new AppError('Invalid target status. Must be OPEN or CLOSED.', 400);
        }

        // Find the target tombola first
        const tombolaToUpdate = await tombolaMonthRepository.findById(tombolaMonthId);
        if (!tombolaToUpdate) {
            throw new AppError('Tombola month not found.', 404);
        }

        // Prevent changing status if already drawn/closed in a final state
        if (tombolaToUpdate.status === TombolaStatus.CLOSED && tombolaToUpdate.winners && tombolaToUpdate.winners.length > 0) {
            throw new AppError('Cannot change status of a tombola that has already been drawn and closed.', 400);
        }
        // Add other checks if needed (e.g., cannot close if drawing?)

        if (newStatus === TombolaStatus.OPEN) {
            // If opening this one, close all others first
            await tombolaMonthRepository.closeAllOpenTombolas();
        }

        // Now update the target tombola's status
        const updatedTombola = await tombolaMonthRepository.findByIdAndUpdate(tombolaMonthId, { status: newStatus });
        if (!updatedTombola) {
            // Should not happen if findById succeeded, but handle defensively
            log.error(`Failed to update status for TombolaMonth ${tombolaMonthId} after finding it.`);
            throw new AppError('Failed to update tombola status.', 500);
        }

        log.info(`Service: Successfully updated status for TombolaMonth ${tombolaMonthId} to ${newStatus}`);
        return updatedTombola;
    }

    /**
     * Retrieves the details of the tombola for a specific month and year.
     *
     * @param month - The month number (1-12).
     * @param year - The full year (e.g., 2024).
     * @returns The TombolaMonth document or null if not found.
     */
    async getTombolaByMonthYear(month: number, year: number): Promise<ITombolaMonth | null> {
        log.info(`Service: Searching for tombola for month: ${month}, year: ${year}`);
        try {
            const tombola = await tombolaMonthRepository.findByMonthYear(month, year);
            if (!tombola) {
                log.info(`Service: No tombola found for month ${month}, year ${year}`);
                return null;
            }
            log.info(`Service: Found tombola ${tombola._id} for month ${month}, year ${year}`);
            return tombola;
        } catch (error) {
            log.error(`Service: Error finding tombola for month ${month}, year ${year}:`, error);
            // Depending on desired behavior, you might re-throw or return null
            // For consistency with repository layer, let's re-throw unexpected errors
            throw error;
        }
    }

    /**
     * Retrieves a paginated list of tickets purchased by a specific user.
     *
     * @param userId - The ID of the user.
     * @param limit - Max number of tickets per page.
     * @param skip - Number of tickets to skip for pagination.
     * @returns An object containing the list of populated tickets and the total count.
     */
    async getUserTickets(userId: string, limit: number = 10, skip: number = 0): Promise<{ tickets: PopulatedTombolaTicket[], totalCount: number }> {
        log.info(`Service: Fetching tickets for user ${userId} (limit: ${limit}, skip: ${skip})`);
        try {
            const userObjectId = new Types.ObjectId(userId);
            const query = { userId: userObjectId };
            const sort = { purchaseTimestamp: -1 as SortOrder }; // Show newest first

            // Use the repository find method which returns populated tickets
            const tickets = await tombolaTicketRepository.find(query, limit, skip, sort);
            const totalCount = await tombolaTicketRepository.count(query);

            log.info(`Service: Found ${tickets.length} of ${totalCount} tickets for user ${userId}.`);
            return { tickets, totalCount };
        } catch (error) {
            log.error(`Service: Error fetching tickets for user ${userId}:`, error);
            throw new AppError('Could not retrieve your tickets.', 500);
        }
    }

    /**
     * Deletes a TombolaMonth by its ID.
     * TODO: Consider adding checks (e.g., cannot delete if tickets exist?)
     *
     * @param tombolaMonthId - The ID of the TombolaMonth to delete.
     * @returns True if deleted successfully, false if not found.
     */
    async deleteTombolaMonth(tombolaMonthId: string): Promise<boolean> {
        log.info(`Service: Attempting to delete TombolaMonth ${tombolaMonthId}`);
        try {
            // Assuming repository has a deleteById method
            const result = await tombolaMonthRepository.deleteById(tombolaMonthId);
            if (!result) {
                log.warn(`Service: TombolaMonth ${tombolaMonthId} not found for deletion.`);
                return false;
            }
            log.info(`Service: Successfully deleted TombolaMonth ${tombolaMonthId}`);
            // TODO: Consider deleting associated tickets if required by business logic
            // await tombolaTicketRepository.deleteMany({ tombolaMonthId: new Types.ObjectId(tombolaMonthId) });
            return true;
        } catch (error) {
            log.error(`Service: Error deleting TombolaMonth ${tombolaMonthId}:`, error);
            throw new AppError('Could not delete tombola month.', 500);
        }
    }

    /**
     * Retrieves a single TombolaMonth by its ID.
     *
     * @param tombolaMonthId - The ID of the TombolaMonth.
     * @returns The TombolaMonth document or null if not found.
     */
    async getTombolaById(tombolaMonthId: string): Promise<ITombolaMonth | null> {
        log.info(`Service: Fetching TombolaMonth by ID: ${tombolaMonthId}`);
        try {
            // ID validation happens in the controller, but could be added here too
            const tombola = await tombolaMonthRepository.findById(tombolaMonthId);
            if (!tombola) {
                log.warn(`Service: TombolaMonth with ID ${tombolaMonthId} not found.`);
                return null;
            }
            log.info(`Service: Successfully found TombolaMonth ${tombolaMonthId}`);
            return tombola;
        } catch (error) {
            log.error(`Service: Error fetching TombolaMonth by ID ${tombolaMonthId}:`, error);
            // Rethrow unexpected errors
            throw new AppError('Database error while fetching tombola month.', 500);
        }
    }

    /**
     * Retrieves an array of all ticket numbers for a specific TombolaMonth.
     *
     * @param tombolaMonthId - The ID of the TombolaMonth.
     * @returns A promise that resolves to an array of numbers (ticket numbers).
     */
    async getAllTicketNumbersForMonth(tombolaMonthId: string): Promise<number[]> {
        log.info(`Service: Fetching all ticket numbers for TombolaMonth ID: ${tombolaMonthId}`);
        try {
            const tickets = await tombolaTicketRepository.findAllTicketNumbersByMonthId(tombolaMonthId);
            const ticketNumbers = tickets.map(ticket => ticket.ticketNumber);
            log.info(`Service: Found ${ticketNumbers.length} ticket numbers for month ${tombolaMonthId}.`);
            return ticketNumbers;
        } catch (error) {
            log.error(`Service: Error fetching ticket numbers for month ${tombolaMonthId}:`, error);
            throw new AppError('Database error while fetching ticket numbers.', 500);
        }
    }

}

export const tombolaService = new TombolaService(); 