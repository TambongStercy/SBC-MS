/**
 * Seed an SSO client. Run interactively with the client_id you want — the script
 * generates and prints a fresh client_secret. The secret is shown ONCE and then
 * hashed into the DB; if you lose it, rotate by re-running this script.
 *
 * Usage:
 *   cd user-service
 *   npx ts-node src/scripts/seed-sso-client.ts \
 *       --clientId=sbc-live \
 *       --name="SBC Live" \
 *       --redirectUri=https://live.sniperbuisnesscenter.com/auth/callback \
 *       --redirectUri=http://localhost:5174/auth/callback \
 *       --scope=profile.read \
 *       --scope=payments.write \
 *       --scope=referrals.read \
 *       --webhookUrl=https://live.sniperbuisnesscenter.com/sbc-webhook
 *
 *   Multiple --redirectUri and --scope flags are accepted (one per value).
 *   --webhookUrl is optional; if set, a fresh webhookSecret is generated and
 *   printed for the third-party to verify HMAC-SHA256 signatures.
 *
 * Re-running with the same clientId rotates the secret AND the webhookSecret
 * (if --webhookUrl provided) and replaces redirectUris + allowedScopes.
 */
import 'dotenv/config';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { SsoClient } from '../database/models/sso-client.model';
import config from '../config';

interface Args {
    clientId?: string;
    name?: string;
    redirectUris: string[];
    scopes: string[];
    webhookUrl?: string;
}

function parseArgs(): Args {
    const args: Args = { redirectUris: [], scopes: [] };
    for (const raw of process.argv.slice(2)) {
        const [k, ...rest] = raw.replace(/^--/, '').split('=');
        const v = rest.join('=');
        if (k === 'clientId') args.clientId = v;
        else if (k === 'name') args.name = v;
        else if (k === 'redirectUri') args.redirectUris.push(v);
        else if (k === 'scope') args.scopes.push(v);
        else if (k === 'webhookUrl') args.webhookUrl = v;
    }
    return args;
}

async function main() {
    const args = parseArgs();
    if (!args.clientId || !args.name || args.redirectUris.length === 0 || args.scopes.length === 0) {
        console.error('Missing required arguments. See the doc comment at the top of this file.');
        process.exit(1);
    }

    await mongoose.connect(config.mongodb.uri, config.mongodb.options as any);
    console.log(`Connected to ${config.mongodb.uri.split('@').pop()}`);

    const secret = crypto.randomBytes(32).toString('hex');
    const hash = await bcrypt.hash(secret, 10);

    const setFields: Record<string, any> = {
        clientId: args.clientId,
        name: args.name,
        clientSecretHash: hash,
        redirectUris: args.redirectUris,
        allowedScopes: args.scopes,
        enabled: true,
    };

    let webhookSecretForPrint: string | undefined;
    if (args.webhookUrl) {
        webhookSecretForPrint = crypto.randomBytes(32).toString('hex');
        setFields.webhookUrl = args.webhookUrl;
        setFields.webhookSecret = webhookSecretForPrint;
    }

    const result = await SsoClient.findOneAndUpdate(
        { clientId: args.clientId },
        { $set: setFields },
        { upsert: true, new: true },
    );

    console.log('');
    console.log('=================================================================');
    console.log('SSO client written. Save these credentials — the secret is shown');
    console.log('only once. Re-running this script rotates the secret.');
    console.log('=================================================================');
    console.log(`  clientId:      ${result.clientId}`);
    console.log(`  clientSecret:  ${secret}`);
    console.log(`  name:          ${result.name}`);
    console.log(`  redirectUris:  ${result.redirectUris.join(', ')}`);
    console.log(`  allowedScopes: ${result.allowedScopes.join(', ')}`);
    if (args.webhookUrl) {
        console.log(`  webhookUrl:    ${args.webhookUrl}`);
        console.log(`  webhookSecret: ${webhookSecretForPrint}`);
        console.log('  --> Configure your webhook endpoint to verify HMAC-SHA256 with this secret.');
    }
    console.log('=================================================================');

    await mongoose.disconnect();
    process.exit(0);
}

main().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
});
