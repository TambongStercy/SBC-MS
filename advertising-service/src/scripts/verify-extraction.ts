/**
 * Manual check for the WhatsApp status extraction path.
 *
 * Prints a QR, waits for a scan, then reports the statuses it read back. Exists
 * because the in-memory auth state is our own implementation of a Baileys
 * interface, and a structural mistake there only shows up against a real server.
 *
 * Credentials are never written to disk, so there is nothing to clean up and
 * nothing to unlink afterwards beyond what the service does itself.
 *
 * Usage:
 *   npx ts-node src/scripts/verify-extraction.ts
 *   MEDIA=1 npx ts-node src/scripts/verify-extraction.ts   # also download bytes
 */
import qrcodeTerminal from 'qrcode-terminal';
import { extractOwnStatuses } from '../services/whatsapp-status.service';

const main = async () => {
    console.log('\nStatus extraction check');
    console.log('Credentials stay in memory. Nothing is written to disk.\n');

    const handle = extractOwnStatuses({
        downloadMedia: process.env.MEDIA === '1',
        timeoutMs: 3 * 60 * 1000,
        onQr: qr => {
            console.log('Scan with WhatsApp > Settings > Linked devices > Link a device:\n');
            qrcodeTerminal.generate(qr, { small: true });
        },
        onConnected: ({ lid, phone }) => {
            console.log(`\nConnected. lid=${lid ?? '?'} phone=${phone ?? '?'}`);
            console.log('Reading statuses...\n');
        },
    });

    const result = await handle.result;

    console.log('='.repeat(58));
    console.log(`STATUSES READ: ${result.statuses.length}`);
    console.log('='.repeat(58));
    for (const s of result.statuses) {
        const when = s.postedAt ? s.postedAt.toLocaleString() : '?';
        console.log(`\n  ${s.mediaType.toUpperCase()}  ${when}`);
        if (s.caption) console.log(`  caption : ${s.caption.replace(/\n/g, ' ').slice(0, 70)}`);
        console.log(`  views   : ${s.viewCount}   (delivered to ${s.deliveredCount})`);
        if (s.mediaBuffer) console.log(`  media   : ${s.mediaBuffer.length} bytes`);
    }
    if (!result.statuses.length) {
        console.log('\n  (none — post a status and re-run; WhatsApp expires them after 24h)');
    }
    console.log('\nDevice unlinked, credentials discarded with the process.');
    process.exit(0);
};

main().catch(err => {
    console.error('\nFailed:', err.message);
    process.exit(1);
});
