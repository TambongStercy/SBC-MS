/**
 * Payment callbacks carry our service secret: they may only go to our own
 * services (utils/callback-allowlist).
 *
 * Run: npx ts-node --transpile-only src/scripts/check-callback-allowlist.ts
 */
import assert from 'assert';

process.env.USER_SERVICE_URL = 'http://10.0.0.5:3001';
process.env.PAYMENT_CALLBACK_ALLOWED_ORIGINS = 'https://api.sniperbuisnesscenter.com, http://event-service:3011';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { checkCallbackUrl, callbackAllowlistEnforced } = require('../utils/callback-allowlist');

const allowed = [
    'http://localhost:3011/api/tickets/webhooks/payment-confirmation',
    'http://127.0.0.1:3002/api/relance/internal/credit-pack',
    'http://10.0.0.5:3001/api/subscriptions/webhooks/payment-confirmation', // configured service URL
    'https://api.sniperbuisnesscenter.com/api/tickets/webhooks/payment-confirmation', // env allowlist
    'http://event-service:3011/api/tickets/webhooks/payment-confirmation',
];
const refused = [
    'https://attacker.example/collect',
    'http://localhost.attacker.example/x',
    'https://api.sniperbuisnesscenter.com.evil.io/x',
    'http://10.0.0.5:9999/x', // right host, wrong port = different origin
    'file:///etc/passwd',
    '/api/tickets/webhooks/payment-confirmation', // not absolute
];

for (const url of allowed) assert.ok(checkCallbackUrl(url).allowed, `should allow ${url}`);
for (const url of refused) assert.ok(!checkCallbackUrl(url).allowed, `should refuse ${url}`);
assert.strictEqual(callbackAllowlistEnforced(), false, 'log-only until explicitly enforced');
process.env.PAYMENT_CALLBACK_ENFORCE_ALLOWLIST = 'true';
assert.strictEqual(callbackAllowlistEnforced(), true);

console.log(`ok  ${allowed.length} service callbacks allowed, ${refused.length} foreign ones refused; enforcement is opt-in`);
