import crypto from 'crypto';
import { Types } from 'mongoose';
import config from '../config';
import { Attachment } from '../database/models/ticket.model';
import { badRequest } from '../utils/errors';
import { storage } from './storage.service';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Type from the file's first bytes, never from the name or the declared type. */
export function sniffMime(buf: Buffer): string | null {
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString('latin1'))) return 'image/gif';
    if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
    if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
    return null;
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf' };

const cleanName = (name: string, mime: string) => {
    const base = String(name || 'fichier').normalize('NFKC').replace(/[^\w.\- ]+/g, '_').slice(0, 80).replace(/\.[^.]*$/, '') || 'fichier';
    return `${base}.${EXT[mime]}`;
};

export async function storeAttachment(file: { buffer: Buffer; originalname: string; size: number } | undefined, owner: { type: 'member' | 'agent'; id: string }) {
    if (!file?.buffer?.length) throw badRequest('Aucun fichier reçu.', 'NO_FILE');
    if (file.size > MAX_ATTACHMENT_BYTES || file.buffer.length > MAX_ATTACHMENT_BYTES) throw badRequest('Fichier trop volumineux (10 Mo au plus).', 'FILE_TOO_LARGE');
    const mime = sniffMime(file.buffer);
    if (!mime) throw badRequest('Seules les images (JPG, PNG, WEBP, GIF) et les PDF sont acceptés.', 'FILE_TYPE');
    const id = new Types.ObjectId();
    const now = new Date();
    const key = `${config.r2.keyPrefix}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id.toHexString()}.${EXT[mime]}`;
    await storage().put(key, file.buffer, mime);
    const doc = await Attachment.create({
        _id: id, owner, key, filename: cleanName(file.originalname, mime), mime, size: file.buffer.length,
        sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
    });
    return { id: String(doc._id), filename: doc.filename, mime, size: doc.size };
}

/** Attaches the owner's own, still-free attachments to a ticket. Returns their ids. */
export async function claimAttachments(ids: unknown, ownerId: string, ticketId: Types.ObjectId): Promise<Types.ObjectId[]> {
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const valid = ids.filter((i) => typeof i === 'string' && Types.ObjectId.isValid(i)).slice(0, 10).map((i) => new Types.ObjectId(i as string));
    if (!valid.length) return [];
    await Attachment.updateMany({ _id: { $in: valid }, 'owner.id': ownerId, ticketId: null }, { $set: { ticketId } });
    const mine = await Attachment.find({ _id: { $in: valid }, ticketId }, { _id: 1 }).lean();
    return mine.map((a) => a._id as Types.ObjectId);
}

export async function attachmentLinks(ids: Types.ObjectId[]) {
    if (!ids.length) return [];
    const docs = await Attachment.find({ _id: { $in: ids } }).lean();
    return Promise.all(docs.map(async (d) => {
        let url: string | null = null;
        try { url = await storage().presignGet(d.key, d.filename); } catch { url = null; }
        return { id: String(d._id), filename: d.filename, mime: d.mime, size: d.size, url };
    }));
}
