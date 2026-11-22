import mongoose from 'mongoose';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import { Application } from 'express';
import { connectDB } from '../lib/db';
import { closeRedis, redis } from '../lib/redis';
import { createApp } from '../app';
import { Agent } from '../database/models/agent.model';
import { hashPassword } from '../services/auth/password.service';
import { encryptSecret, generateBackupCodes } from '../services/auth/totp.service';
import { invalidateSettingsCache } from '../services/settings.service';
import { setStorageDriver } from '../services/storage.service';
import * as models from '../database/models/all';

export const ORIGIN = 'https://support.test';
export const PASSWORD = 'Correct-Horse-Battery-Staple-42';

let app: Application;
export const getApp = () => (app ??= createApp());

export async function setupDb(): Promise<void> {
    if (mongoose.connection.readyState !== 1) await connectDB();
    const name = mongoose.connection.name;
    if (name !== 'sbc_support_test') throw new Error(`refusing to touch database ${name}`);
    // Let the automatic index builds finish before dropping, then rebuild them.
    for (const m of Object.values(models)) await (m as any).init();
    await mongoose.connection.dropDatabase();
    for (const m of Object.values(models)) await (m as any).createIndexes();
    await flushRedis();
    invalidateSettingsCache();
    setStorageDriver({ put: async () => undefined, presignGet: async (key) => `https://r2.test/${key}` });
}

export async function flushRedis(): Promise<void> {
    const r = redis();
    let cursor = '0';
    do {
        const [next, keys] = await r.scan(cursor, 'MATCH', 'sbc-support:test:*', 'COUNT', 500);
        cursor = next;
        if (keys.length) await r.del(...keys);
    } while (cursor !== '0');
}

export async function teardown(): Promise<void> {
    await closeRedis();
    await mongoose.disconnect();
}

export interface TestAgent { id: string; email: string; secret: string; backupCodes: string[] }

export async function makeAgent(roles: string[], opts: { email?: string; enrolled?: boolean; status?: string } = {}): Promise<TestAgent> {
    const email = opts.email ?? `${roles.join('-')}-${Math.random().toString(36).slice(2, 8)}@agents.test`;
    const secret = authenticator.generateSecret(20);
    const { codes, hashes } = generateBackupCodes(10);
    const enrolled = opts.enrolled !== false;
    const a = await Agent.create({
        email, name: `Agent ${roles[0]}`, roles, status: opts.status ?? 'active', passwordHash: await hashPassword(PASSWORD),
        totp: enrolled ? { secretEnc: encryptSecret(secret), enrolled: true, enrolledAt: new Date(), lastUsedStep: null } : { enrolled: false },
        backupCodes: enrolled ? hashes.map((hash) => ({ hash, usedAt: null })) : [],
    });
    return { id: String(a._id), email, secret, backupCodes: codes };
}

/** A fresh TOTP code; the replay guard is reset first (tests sign in many times within 30 s). */
export async function totp(agent: TestAgent): Promise<string> {
    await Agent.updateOne({ _id: agent.id }, { $set: { 'totp.lastUsedStep': null } });
    return authenticator.generate(agent.secret);
}

export type Jar = Record<string, string>;

export function readCookies(res: request.Response, jar: Jar = {}): Jar {
    const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
    for (const c of raw ?? []) {
        const [pair] = c.split(';');
        const i = pair.indexOf('=');
        const name = pair.slice(0, i).trim();
        const value = decodeURIComponent(pair.slice(i + 1));
        if (value === '' || /Expires=Thu, 01 Jan 1970/i.test(c)) delete jar[name];
        else jar[name] = value;
    }
    return jar;
}

export const cookieHeader = (jar: Jar) => Object.entries(jar).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');

/** Desk request with cookies, Origin and the CSRF header. */
export function desk(method: 'get' | 'post' | 'put', path: string, jar: Jar, extra: Record<string, string> = {}) {
    const r = (request(getApp()) as any)[method](`/api/support/desk${path}`)
        .set('Origin', ORIGIN)
        .set('Cookie', cookieHeader(jar));
    if (jar.sbc_sup_csrf) r.set('x-csrf-token', jar.sbc_sup_csrf);
    for (const [k, v] of Object.entries(extra)) r.set(k, v);
    return r as request.Test;
}

export async function csrfJar(): Promise<Jar> {
    const res = await request(getApp()).get('/api/support/desk/auth/csrf');
    return readCookies(res);
}

export async function login(agent: TestAgent): Promise<Jar> {
    const jar = await csrfJar();
    const l = await desk('post', '/auth/login', jar).send({ email: agent.email, password: PASSWORD });
    if (l.status !== 200) throw new Error(`login failed ${l.status} ${JSON.stringify(l.body)}`);
    const t = await desk('post', '/auth/totp', jar).send({ challengeId: l.body.data.challengeId, code: await totp(agent) });
    if (t.status !== 200) throw new Error(`totp failed ${t.status} ${JSON.stringify(t.body)}`);
    return readCookies(t, jar);
}

export async function reauthToken(agent: TestAgent, jar: Jar): Promise<string> {
    const r = await desk('post', '/auth/reauth', jar).send({ code: await totp(agent) });
    if (r.status !== 200) throw new Error(`reauth failed ${r.status}`);
    return r.body.data.reauthToken;
}

export const memberToken = (userId = '6e2e00000000000000000b01') =>
    jwt.sign({ userId, id: userId, email: 'member@e2e.test', role: 'user' }, process.env.JWT_SECRET!, { expiresIn: '1h' });

export interface FetchCall { url: string; method: string; headers: Record<string, string>; body: any }

/** Replaces global fetch: routes by URL substring, records every call, refuses anything unrouted. */
export function mockFetch(routes: Record<string, (call: FetchCall) => { status?: number; json?: unknown; raw?: Buffer; contentType?: string }>) {
    const calls: FetchCall[] = [];
    const spy = jest.spyOn(global, 'fetch').mockImplementation(async (input: any, init: any = {}) => {
        const url = String(input);
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = String(v);
        let body: any = init.body;
        try { body = typeof body === 'string' ? JSON.parse(body) : body; } catch { /* keep raw */ }
        const call = { url, method: init.method ?? 'GET', headers, body };
        calls.push(call);
        const key = Object.keys(routes).find((k) => url.includes(k));
        if (!key) throw new TypeError(`fetch failed (unmocked ${url})`);
        const r = routes[key](call);
        if (r.raw) return new Response(new Uint8Array(r.raw), { status: r.status ?? 200, headers: { 'Content-Type': r.contentType ?? 'application/octet-stream' } });
        return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    });
    return { calls, restore: () => spy.mockRestore() };
}
