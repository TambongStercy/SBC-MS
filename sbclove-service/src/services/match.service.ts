import { matchRepository } from '../database/repositories/match.repository';
import { loveProfileRepository } from '../database/repositories/love-profile.repository';
import { userServiceClient } from './clients/user.service.client';
import { sbcloveNotificationService } from './notification.service';
import { ContactChoice, ageBracketFromBirthDate } from '../types/sbclove.enums';
import { settingsServiceClient } from './clients/settings.service.client';
import { IMatch } from '../database/models/match.model';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';

const log = logger.getLogger('MatchService');

// "Mes matchs" card (spec §12): photo, display name, city, intention + my/other choice.
export interface MatchView {
    matchId: string;
    otherUserId: string;
    displayName: string;
    city?: string;
    ageBracket: string | null;
    intention?: string;
    photoUrl?: string;
    myChoice: ContactChoice;
    contactUnlocked: boolean;
    createdAt: Date;
}

class MatchService {

    /** Lists the caller's matches, hydrated for the "Mes matchs" space (spec §12). */
    async getMyMatches(userId: string, limit: number, skip: number): Promise<MatchView[]> {
        const matches = await matchRepository.findForUser(userId, limit, skip);
        if (matches.length === 0) return [];

        const otherIds = matches.map(m => this.otherUserId(m, userId));
        const [users, profiles] = await Promise.all([
            userServiceClient.getUsersByIds(otherIds),
            Promise.all(otherIds.map(id => loveProfileRepository.findByUserId(id))),
        ]);
        const userMap = new Map(users.map(u => [u._id.toString(), u]));
        const profileMap = new Map(profiles.filter(Boolean).map(p => [p!.userId.toString(), p!]));

        return matches.map(m => {
            const otherId = this.otherUserId(m, userId);
            const user = userMap.get(otherId);
            const profile = profileMap.get(otherId);
            const firstPhoto = profile?.photos?.slice().sort((a, b) => a.order - b.order)[0];
            return {
                matchId: m._id.toString(),
                otherUserId: otherId,
                displayName: profile?.displayName || user?.name || 'Membre SBC',
                city: user?.city,
                ageBracket: ageBracketFromBirthDate(user?.birthDate),
                intention: profile?.intention,
                photoUrl: firstPhoto ? settingsServiceClient.getFileUrl(firstPhoto.fileId) : undefined,
                myChoice: this.choiceOf(m, userId),
                contactUnlocked: m.contactUnlocked,
                createdAt: m.createdAt,
            };
        });
    }

    /**
     * Records the caller's contact choice within a match (double opt-in, spec §13).
     * Unlocks contact only when both participants chose WANTS_CONTACT.
     */
    async setContactChoice(userId: string, matchId: string, choice: ContactChoice): Promise<{ contactUnlocked: boolean }> {
        if (choice === ContactChoice.PENDING) {
            throw new AppError('Invalid contact choice.', 400);
        }
        const match = await matchRepository.findById(matchId);
        if (!match || !this.isParticipant(match, userId)) {
            throw new AppError('Match not found.', 404);
        }

        // Idempotent: re-submitting the same choice is a no-op (no duplicate emails).
        const previousChoice = this.choiceOf(match, userId);
        if (previousChoice === choice) {
            return { contactUnlocked: match.contactUnlocked };
        }

        const updated = await matchRepository.setParticipantChoice(matchId, userId, choice);
        if (!updated) {
            throw new AppError('Could not update contact choice.', 500);
        }

        const otherId = this.otherUserId(updated, userId);

        // Emails only fire on a real transition INTO wants_contact (guaranteed here
        // because previousChoice !== choice), so they can't be spammed by repeats.
        if (choice === ContactChoice.WANTS_CONTACT) {
            const bothWant = updated.participants.every(p => p.choice === ContactChoice.WANTS_CONTACT);
            if (bothWant) {
                if (!updated.contactUnlocked) {
                    await matchRepository.markContactUnlocked(matchId);
                    Promise.allSettled([
                        sbcloveNotificationService.sendContactUnlockedEmail(userId),
                        sbcloveNotificationService.sendContactUnlockedEmail(otherId),
                    ]);
                }
                return { contactUnlocked: true };
            }
            // First/only side to opt in → notify the other party once (spec §13).
            sbcloveNotificationService.sendContactRequestEmail(otherId)
                .catch(err => log.error('Contact-request email error:', err));
        }

        return { contactUnlocked: updated.contactUnlocked };
    }

    private isParticipant(match: IMatch, userId: string): boolean {
        return match.participants.some(p => p.userId.toString() === userId);
    }

    private choiceOf(match: IMatch, userId: string): ContactChoice {
        return match.participants.find(p => p.userId.toString() === userId)?.choice ?? ContactChoice.PENDING;
    }

    private otherUserId(match: IMatch, userId: string): string {
        return match.userA.toString() === userId ? match.userB.toString() : match.userA.toString();
    }
}

export const matchService = new MatchService();
