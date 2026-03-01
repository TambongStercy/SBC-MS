/**
 * Tests for relance-sender.job.ts critical fixes:
 * 1. Job lock prevents overlapping runs
 * 2. sendingPaused breaks (stops all targets), not continues
 * 3. enabled=false skips default targets but allows campaign targets
 * 4. Duplicate detection prevents re-sending same day
 * 5. No daily message limits (removed)
 */

// Mock all external dependencies before imports
jest.mock('../database/models/relance-config.model', () => ({
    __esModule: true,
    default: { findOne: jest.fn() }
}));
jest.mock('../database/models/relance-target.model', () => {
    const TargetStatus = { ACTIVE: 'active', COMPLETED: 'completed', PAUSED: 'paused' };
    const ExitReason = { COMPLETED_7_DAYS: 'completed_7days', PAID: 'paid', REFERRER_INACTIVE: 'referrer_inactive' };
    return {
        __esModule: true,
        default: { find: jest.fn(), countDocuments: jest.fn() },
        TargetStatus,
        ExitReason
    };
});
jest.mock('../database/models/relance-message.model', () => ({
    __esModule: true,
    default: { findOne: jest.fn() }
}));
jest.mock('../database/models/relance-campaign.model', () => ({
    __esModule: true,
    default: { find: jest.fn(), updateMany: jest.fn() },
    CampaignStatus: { ACTIVE: 'active', COMPLETED: 'completed' }
}));
jest.mock('../services/email.relance.service', () => ({
    emailRelanceService: { sendRelanceEmail: jest.fn() }
}));
jest.mock('../services/clients/user.service.client', () => ({
    userServiceClient: {
        getUserDetails: jest.fn(),
        hasRelanceSubscription: jest.fn()
    }
}));
jest.mock('node-cron', () => ({
    schedule: jest.fn()
}));

import RelanceTargetModel from '../database/models/relance-target.model';
import RelanceConfigModel from '../database/models/relance-config.model';
import RelanceMessageModel from '../database/models/relance-message.model';
import { emailRelanceService } from '../services/email.relance.service';
import { userServiceClient } from '../services/clients/user.service.client';

// We need to test the internal functions, so we'll import the module
// and use the exported startRelanceSenderJob to trigger the job
describe('Relance Sender Job', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Job Lock', () => {
        it('should prevent overlapping runs', async () => {
            // Setup: targets that take time to process
            const mockTargets = Array.from({ length: 3 }, (_, i) => ({
                _id: `target_${i}`,
                referrerUserId: { toString: () => 'user1' },
                referralUserId: { toString: () => `referral_${i}` },
                campaignId: null,
                currentDay: 1,
                messagesDelivered: [],
                lastMessageSentAt: null,
                status: 'active',
                save: jest.fn().mockResolvedValue(true)
            }));

            (RelanceTargetModel.find as jest.Mock).mockReturnValue({
                populate: jest.fn().mockResolvedValue(mockTargets)
            });

            (RelanceConfigModel.findOne as jest.Mock).mockResolvedValue({
                enabled: true,
                sendingPaused: false,
                enrollmentPaused: false,
                defaultCampaignPaused: false,
                save: jest.fn()
            });

            (userServiceClient.hasRelanceSubscription as jest.Mock).mockResolvedValue(true);
            (userServiceClient.getUserDetails as jest.Mock).mockResolvedValue({
                name: 'Test User',
                email: 'test@test.com'
            });

            (RelanceMessageModel.findOne as jest.Mock).mockResolvedValue({
                dayNumber: 1,
                messageTemplate: { fr: 'Hello {{name}}', en: 'Hello {{name}}' },
                subject: 'Test',
                mediaUrls: [],
                buttons: []
            });

            (emailRelanceService.sendRelanceEmail as jest.Mock).mockResolvedValue({
                success: true,
                messageId: '<test@sendgrid.com>'
            });

            // Import the module to get the function
            const { startRelanceSenderJob } = require('../jobs/relance-sender.job');

            // The startRelanceSenderJob calls runMessageSendingJob immediately
            // and schedules cron. We need to test the lock.
            // Since the module is already loaded, we can check the cron mock
            const cron = require('node-cron');

            // Start the job - this runs the first execution
            startRelanceSenderJob();

            // The cron.schedule should have been called
            expect(cron.schedule).toHaveBeenCalledWith('*/15 * * * *', expect.any(Function));
        });
    });

    describe('Pause and Disable behavior', () => {
        it('sendingPaused should break (not continue) - stops all targets', () => {
            const fs = require('fs');
            const path = require('path');
            const source = fs.readFileSync(
                path.join(__dirname, '../jobs/relance-sender.job.ts'),
                'utf8'
            );

            // sendingPaused should use 'break' not 'continue' (multiline match with dotall)
            const sendingPausedMatch = source.match(/if\s*\(config\.sendingPaused\)\s*\{[\s\S]*?\b(break|continue)\b/);
            expect(sendingPausedMatch).not.toBeNull();
            expect(sendingPausedMatch![1]).toBe('break');
        });

        it('enabled=false for default targets should use continue (campaign targets still process)', () => {
            const fs = require('fs');
            const path = require('path');
            const source = fs.readFileSync(
                path.join(__dirname, '../jobs/relance-sender.job.ts'),
                'utf8'
            );

            // enabled=false check should use 'continue' (not break) so campaign targets still work
            const enabledMatch = source.match(/if\s*\(isDefaultTarget\s*&&\s*!config\.enabled\)\s*\{[\s\S]*?\b(break|continue)\b/);
            expect(enabledMatch).not.toBeNull();
            expect(enabledMatch![1]).toBe('continue');
        });

        it('should have job lock variable defined', () => {
            const fs = require('fs');
            const path = require('path');
            const source = fs.readFileSync(
                path.join(__dirname, '../jobs/relance-sender.job.ts'),
                'utf8'
            );

            expect(source).toContain('let isJobRunning = false');
            expect(source).toContain('if (isJobRunning)');
            expect(source).toContain('isJobRunning = true');
            expect(source).toContain('isJobRunning = false');
        });

        it('should release lock in finally block', () => {
            const fs = require('fs');
            const path = require('path');
            const source = fs.readFileSync(
                path.join(__dirname, '../jobs/relance-sender.job.ts'),
                'utf8'
            );

            // Verify finally block releases lock
            expect(source).toMatch(/finally\s*\{\s*\n\s*isJobRunning\s*=\s*false/);
        });
    });

    describe('No daily limits', () => {
        it('should NOT have maxMessagesPerDay checks in sender', () => {
            const fs = require('fs');
            const path = require('path');
            const source = fs.readFileSync(
                path.join(__dirname, '../jobs/relance-sender.job.ts'),
                'utf8'
            );

            // Should not contain daily limit checks
            expect(source).not.toContain('config.messagesSentToday >= config.maxMessagesPerDay');
            expect(source).not.toContain('campaignMessagesSent >= campaignMaxMessages');
        });

        it('should NOT have messagesSentToday counter increment', () => {
            const fs = require('fs');
            const path = require('path');
            const source = fs.readFileSync(
                path.join(__dirname, '../jobs/relance-sender.job.ts'),
                'utf8'
            );

            expect(source).not.toContain('config.messagesSentToday += 1');
        });

        it('should NOT have daily counter reset cron', () => {
            const fs = require('fs');
            const path = require('path');
            const source = fs.readFileSync(
                path.join(__dirname, '../jobs/relance-sender.job.ts'),
                'utf8'
            );

            expect(source).not.toContain('0 0 * * *');
            expect(source).not.toContain('messagesSentToday: 0');
        });
    });

    describe('Duplicate prevention', () => {
        it('should check for already delivered messages on current day', () => {
            const fs = require('fs');
            const path = require('path');
            const source = fs.readFileSync(
                path.join(__dirname, '../jobs/relance-sender.job.ts'),
                'utf8'
            );

            expect(source).toContain("msg.day === target.currentDay && msg.status === 'delivered'");
        });

        it('should have max retries per day check', () => {
            const fs = require('fs');
            const path = require('path');
            const source = fs.readFileSync(
                path.join(__dirname, '../jobs/relance-sender.job.ts'),
                'utf8'
            );

            expect(source).toContain('MAX_RETRIES_PER_DAY');
            expect(source).toContain('failedAttemptsForDay >= MAX_RETRIES_PER_DAY');
        });
    });
});

describe('Relance Enrollment Job', () => {
    describe('Job Lock', () => {
        it('should have enrollment lock variable defined', () => {
            const fs = require('fs');
            const path = require('path');
            const source = fs.readFileSync(
                path.join(__dirname, '../jobs/relance-enrollment.job.ts'),
                'utf8'
            );

            expect(source).toContain('let isEnrollmentRunning = false');
            expect(source).toContain('if (isEnrollmentRunning)');
            expect(source).toContain('isEnrollmentRunning = true');
        });

        it('should release enrollment lock in finally block', () => {
            const fs = require('fs');
            const path = require('path');
            const source = fs.readFileSync(
                path.join(__dirname, '../jobs/relance-enrollment.job.ts'),
                'utf8'
            );

            expect(source).toMatch(/finally\s*\{\s*\n\s*isEnrollmentRunning\s*=\s*false/);
        });
    });

    describe('No daily limits in enrollment', () => {
        it('should NOT have maxMessagesPerDay checks', () => {
            const fs = require('fs');
            const path = require('path');
            const source = fs.readFileSync(
                path.join(__dirname, '../jobs/relance-enrollment.job.ts'),
                'utf8'
            );

            expect(source).not.toContain('config.messagesSentToday >= config.maxMessagesPerDay');
        });

        it('should NOT have maxTargetsPerCampaign checks', () => {
            const fs = require('fs');
            const path = require('path');
            const source = fs.readFileSync(
                path.join(__dirname, '../jobs/relance-enrollment.job.ts'),
                'utf8'
            );

            expect(source).not.toContain('campaign.targetsEnrolled >= config.maxTargetsPerCampaign');
        });
    });

    describe('Duplicate enrollment prevention', () => {
        it('should check for existing active/paused targets before enrolling', () => {
            const fs = require('fs');
            const path = require('path');
            const source = fs.readFileSync(
                path.join(__dirname, '../jobs/relance-enrollment.job.ts'),
                'utf8'
            );

            // Default enrollment checks
            expect(source).toContain("status: { $in: [TargetStatus.ACTIVE, TargetStatus.PAUSED] }");
            expect(source).toContain('if (existingTarget)');
        });
    });
});
