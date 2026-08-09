// Reproduces the exact shapes Baileys returns, to prove the filter change.
const epochOf = (value: unknown): number => {
    if (value == null) return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return Number(value) || 0;
    const long = value as { toNumber?: () => number; low?: number; high?: number };
    if (typeof long.toNumber === 'function') { try { return long.toNumber(); } catch { return 0; } }
    if (typeof long.low === 'number') return long.low + (long.high ?? 0) * 4294967296;
    return 0;
};

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

const unsetLong = { low: 0, high: 0, unsigned: false };
const setLong = { low: 1786263530, high: 0, unsigned: false };
const longWithToNumber = { low: 1786263530, high: 0, toNumber: () => 1786263530 };

check('an unset Long is truthy — the original bug', Boolean(unsetLong) === true);
check('but reads as zero', epochOf(unsetLong) === 0);
check('a set Long reads as its value', epochOf(setLong) === 1786263530);
check('toNumber() is preferred when present', epochOf(longWithToNumber) === 1786263530);
check('plain numbers pass through', epochOf(1786263530) === 1786263530);
check('strings are parsed', epochOf('1786263530') === 1786263530);
check('null and undefined are zero', epochOf(null) === 0 && epochOf(undefined) === 0);

// 216 recipients, all delivered, only 13 actually read — Sterling's status.
const receipts = Array.from({ length: 216 }, (_, i) => ({
    receiptTimestamp: setLong,
    readTimestamp: i < 13 ? setLong : unsetLong,
}));

const oldViews = receipts.filter(r => r.readTimestamp).length;
const newViews = receipts.filter(r => epochOf(r.readTimestamp) > 0).length;

check('the old filter counted every recipient', oldViews === 216, `${oldViews}`);
check('the new filter counts only real views', newViews === 13, `${newViews}`);
check('delivered still counts everyone', receipts.filter(r => epochOf(r.receiptTimestamp) > 0).length === 216);

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
