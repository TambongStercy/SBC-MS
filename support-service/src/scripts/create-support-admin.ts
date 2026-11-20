/**
 * Bootstraps the first support_admin (or any agent) when no admin can create it from the desk.
 *
 *   npx ts-node src/scripts/create-support-admin.ts --email admin@example.com --name "Prénom Nom" [--roles support_admin]
 *   node dist/scripts/create-support-admin.js --email … --name …   (on the server, after build)
 *
 * Prints the one-time activation link (48 h) to stdout only: it is never
 * logged, never stored in clear (only its hash is), and never emailed by this
 * script. Hand it to the person over a trusted channel. The action is audited.
 */
import mongoose from 'mongoose';
import { connectDB } from '../lib/db';
import { closeRedis } from '../lib/redis';
import { Agent } from '../database/models/agent.model';
import { isRole } from '../config/permissions';
import { issueActivation } from '../services/auth/agent-auth.service';
import { audit } from '../services/audit.service';

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
    const email = (arg('email') || '').trim().toLowerCase();
    const name = (arg('name') || '').trim();
    const roles = (arg('roles') || 'support_admin').split(',').map((r) => r.trim()).filter(Boolean);
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email) || name.length < 2) {
        process.stderr.write('Usage: create-support-admin --email <email> --name "<name>" [--roles support_admin,...]\n');
        process.exit(2);
    }
    if (!roles.every(isRole)) {
        process.stderr.write(`Unknown role in: ${roles.join(',')}\n`);
        process.exit(2);
    }
    await connectDB();
    let agent = await Agent.findOne({ email });
    if (agent && agent.status === 'active') {
        process.stderr.write('An active agent already uses this email. Use the desk (Administration → Agents → Réinitialiser) instead.\n');
        process.exit(1);
    }
    if (!agent) agent = await Agent.create({ email, name, roles, status: 'pending' });
    else await Agent.updateOne({ _id: agent._id }, { $set: { name, roles, status: 'pending' } });
    const link = await issueActivation(String(agent._id), null);
    await audit({ actor: { type: 'system', id: 'create-support-admin', name: 'CLI' }, action: 'agent.created', target: { type: 'agent', id: String(agent._id) }, after: { email, roles, via: 'cli' } });
    process.stdout.write(`\nAgent ${email} (${roles.join(', ')}) ready.\nActivation link (single use, expires ${link.expiresAt.toISOString()}):\n\n${link.url}\n\n`);
    await closeRedis();
    await mongoose.disconnect();
}

main().catch(async (err) => {
    process.stderr.write(`Failed: ${(err as Error).message}\n`);
    await closeRedis().catch(() => undefined);
    process.exit(1);
});
