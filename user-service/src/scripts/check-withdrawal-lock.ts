/**
 * Guards the withdrawal lock after an email/phone change (utils/withdrawal-lock.ts).
 *
 * The phone comparison matters as much as the lock: older accounts store
 * numbers without their dialling code, and the profile page resends the
 * member's own number on every save. Counting that as a change would block
 * withdrawals for 48 h after editing a city.
 *
 *   npx ts-node src/scripts/check-withdrawal-lock.ts
 */
import config from '../config';
import { isSamePhoneNumber } from '../utils/phone.utils';
import { withdrawalLockFields, withdrawalLockStatus } from '../utils/withdrawal-lock';

let failures = 0;
const check = (label: string, ok: boolean) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) failures++;
};

// Same line in two formats: not a change.
check('identical numbers', isSamePhoneNumber('237677123456', '237677123456'));
check('stored without dialling code', isSamePhoneNumber('677123456', '237677123456'));
check('submitted with + and spaces', isSamePhoneNumber('237677123456', '+237 677 12 34 56'));
check('Congo keeps its 0', isSamePhoneNumber('061234567', '242061234567'));

// Real changes.
check('different number', !isSamePhoneNumber('237677123456', '237699999999'));
check('same suffix, other line', !isSamePhoneNumber('237677123456', '237677123457'));
check('short suffix is not enough', !isSamePhoneNumber('3456', '237677123456'));
check('empty vs number', !isSamePhoneNumber('', '237677123456'));

// Lock window.
const now = new Date('2026-10-22T10:00:00Z');
const fields = withdrawalLockFields('email_change', now);
const hours = config.withdrawal.lockHoursAfterContactChange;
check(`lock lasts ${hours} h`, fields.withdrawalsLockedUntil.getTime() - now.getTime() === hours * 3600_000);
check('lock reason kept', fields.withdrawalLockReason === 'email_change');

const during = withdrawalLockStatus(fields, new Date(now.getTime() + 60_000));
check('locked right after the change', during.locked && during.until === fields.withdrawalsLockedUntil.toISOString() && during.reason === 'email_change');
check('unlocked once the time is up', !withdrawalLockStatus(fields, fields.withdrawalsLockedUntil).locked);
check('never-changed account is unlocked', !withdrawalLockStatus({}).locked);

if (failures) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
}
console.log('\nAll withdrawal-lock checks passed');
