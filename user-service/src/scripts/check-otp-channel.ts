/**
 * Asserts where a sign-in code goes while WhatsApp OTP is off.
 *
 * Meta rejected both OTP templates on 2026-10-12 (reason "SCAM"), so every
 * WhatsApp code failed. Unless WHATSAPP_OTP_ENABLED=true, codes go by email.
 *
 *   npx ts-node src/scripts/check-otp-channel.ts
 */
import { userService } from '../services/user.service';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const pick = (user: any, override?: 'email' | 'whatsapp') => (userService as any).getOtpDeliveryInfo(user, override);
const member = { email: 'paul@example.com', phoneNumber: '237670000000', notificationPreference: 'whatsapp' };

delete process.env.WHATSAPP_OTP_ENABLED;
let r = pick(member);
check('WhatsApp preference goes by email while WhatsApp OTP is off', r.channel === 'email' && r.recipient === member.email, JSON.stringify(r));
r = pick({ ...member, notificationPreference: 'email' }, 'whatsapp');
check('"Renvoyer par WhatsApp" goes by email while off', r.channel === 'email', JSON.stringify(r));
r = pick({ ...member, email: undefined });
check('no email on the account: still tries WhatsApp', r.channel === 'whatsapp', JSON.stringify(r));

process.env.WHATSAPP_OTP_ENABLED = 'true';
r = pick(member);
check('WHATSAPP_OTP_ENABLED=true restores WhatsApp', r.channel === 'whatsapp' && r.recipient === member.phoneNumber, JSON.stringify(r));
r = pick({ ...member, notificationPreference: 'email' });
check('email preference unchanged', r.channel === 'email');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
