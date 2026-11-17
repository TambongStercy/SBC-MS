import config from '../config';
import { redis, k } from '../lib/redis';
import { Agent } from '../database/models/agent.model';
import { AgentNotification } from '../database/models/agent-notification.model';
import { sendEmail, sendPush } from './clients/notification.client';
import { getSupportMember } from './clients/user.client';
import logger from '../utils/logger';

const log = logger.getLogger('Notifier');

/** True the first time a tag is seen within ttl: notifications are deduplicated by tag. */
async function firstTime(tag: string, ttlSec: number): Promise<boolean> {
    try {
        return (await redis().set(k(`notif:${tag}`), '1', 'EX', ttlSec, 'NX')) === 'OK';
    } catch {
        return true;
    }
}

/** Member notification: push (category support) and email. Never any amount in the text. */
export async function notifyMember(args: { userId: string; tag: string; title: string; body: string; path?: string; email?: boolean; dedupSec?: number }): Promise<void> {
    if (!(await firstTime(`member:${args.tag}`, args.dedupSec ?? 600))) return;
    const url = `${config.memberAppUrl}${args.path ?? '/aide'}`;
    await sendPush({ userId: args.userId, title: args.title, body: args.body, url: args.path ?? '/aide', tag: args.tag });
    if (args.email === false) return;
    try {
        const member = await getSupportMember(args.userId);
        if (member?.email) {
            await sendEmail({ recipient: member.email, userId: args.userId, subject: args.title, body: `${args.body}\n\n${url}`, tag: args.tag });
        }
    } catch (err) {
        log.warn('member email skipped: member lookup failed', { message: (err as Error).message });
    }
}

/** Desk bell (and optionally email) for one agent or for every active agent holding a role. */
export async function notifyAgents(args: {
    agentId?: string; role?: string; kind: string; title: string; body: string; link?: string; dedupKey?: string; email?: boolean;
}): Promise<void> {
    try {
        await AgentNotification.create({
            agentId: args.agentId ?? null, role: args.role ?? null, kind: args.kind, title: args.title, body: args.body,
            link: args.link ?? null, dedupKey: args.dedupKey,
        });
    } catch (err: any) {
        if (err?.code === 11000) return; // already notified
        log.warn('agent notification write failed', { message: err?.message });
        return;
    }
    if (!args.email) return;
    const filter = args.agentId ? { _id: args.agentId, status: 'active' } : { roles: args.role, status: 'active' };
    const agents = await Agent.find(filter, { email: 1 }).limit(50).lean();
    for (const a of agents) {
        await sendEmail({ recipient: a.email, subject: `[SBC Support] ${args.title}`, body: `${args.body}\n\n${config.publicUrl}${args.link ?? ''}`, tag: args.dedupKey ?? args.kind });
    }
}
