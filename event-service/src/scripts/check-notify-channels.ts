/**
 * Notification fan-out table (spec §23): which channels get an attempt for a
 * given set of coordinates, and with which recipient.
 *
 * Run: npx ts-node --transpile-only src/scripts/check-notify-channels.ts
 * Pure — no Mongo, no network, no server.
 */
import assert from 'assert';
import { planChannels } from '../services/clients/notification.service.client';

const ALL = ['push', 'email', 'sms'];
const chans = (plan: { channel: string }[]) => plan.map((p) => p.channel).sort().join(',');
const userId = '65f000000000000000000001';

// Phone but no email (the common SBC buyer): email skipped, sms + push attempted.
const phoneOnly = planChannels({ channels: ['push', 'email', 'sms'], phone: '+237600000000', userId, enabled: ALL });
assert.strictEqual(chans(phoneOnly), 'push,sms');
assert.strictEqual(phoneOnly.find((p) => p.channel === 'sms')!.recipient, '+237600000000');
// push has no address of its own — it must still carry a non-empty recipient,
// because notification-service's schema marks the field required on every channel.
assert.ok(phoneOnly.find((p) => p.channel === 'push')!.recipient);

// Email but no phone: sms skipped.
assert.strictEqual(chans(planChannels({ channels: ['push', 'email', 'sms'], email: 'a@b.test', userId, enabled: ALL })), 'email,push');

// Both known: everything requested goes out, each to its own coordinate.
const both = planChannels({ channels: ['push', 'email', 'sms'], email: 'a@b.test', phone: '+237600000000', userId, enabled: ALL });
assert.strictEqual(chans(both), 'email,push,sms');
assert.strictEqual(both.find((p) => p.channel === 'email')!.recipient, 'a@b.test');

// Deployment switch: EVENT_NOTIFY_CHANNELS=push,email kills SMS everywhere.
assert.strictEqual(chans(planChannels({ channels: ['push', 'email', 'sms'], email: 'a@b.test', phone: '+237600000000', userId, enabled: ['push', 'email'] })), 'email,push');

// Reminder asks for push+sms only — an email address doesn't buy an email.
assert.strictEqual(chans(planChannels({ channels: ['push', 'sms'], email: 'a@b.test', phone: '+237600000000', userId, enabled: ALL })), 'push,sms');

// No userId (anonymous context) → no push, since push identifies by userId.
assert.strictEqual(chans(planChannels({ channels: ['push', 'email'], email: 'a@b.test', enabled: ALL })), 'email');

// Nothing known at all → nothing attempted (and notifyUser logs a warning).
assert.strictEqual(planChannels({ channels: ['push', 'email', 'sms'], enabled: ALL }).length, 0);

console.log('✅ notify fan-out table OK');
