import { Response } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { Types } from 'mongoose';
import { AppError } from '../../../utils/errors';
import { AnimCandidate, AnimChallenge } from '../models/challenge.model';
import { AnimAuditLog } from '../models/governance.model';
import { AnimResult, AnimRewardWinner } from '../models/reward.model';
import { AnimVote, AnimVoteTransaction } from '../models/vote.model';
import { computeEntries } from './board.service';

/**
 * Exports (§42): CSV, Excel or PDF for candidates, votes, transactions,
 * leaderboard, results, winners and the audit log. Rows are streamed from a
 * cursor — a challenge with a million votes exports without loading them.
 * PDF is a summary document and stops at MAX_PDF_ROWS.
 */
export type ExportKind = 'candidates' | 'votes' | 'transactions' | 'leaderboard' | 'results' | 'winners' | 'audit';
export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

const MAX_PDF_ROWS = 2000;

interface Sheet { title: string; columns: { key: string; header: string; width?: number }[]; rows: () => AsyncIterable<Record<string, unknown>> }

const fmtDate = (d?: Date | string | null) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) : '');

async function* cursorRows<T>(cursor: AsyncIterable<T>, map: (doc: T) => Record<string, unknown>) {
    for await (const doc of cursor) yield map(doc);
}

const buildSheet = async (kind: ExportKind, scope: { eventId?: string; challengeId?: string }): Promise<Sheet> => {
    const filter: Record<string, unknown> = {};
    if (scope.eventId) filter.eventId = new Types.ObjectId(scope.eventId);
    if (scope.challengeId) filter.challengeId = new Types.ObjectId(scope.challengeId);
    switch (kind) {
        case 'candidates':
            return {
                title: 'Candidats',
                columns: [
                    { key: 'number', header: 'N°', width: 6 }, { key: 'displayName', header: 'Nom', width: 28 }, { key: 'category', header: 'Catégorie', width: 16 },
                    { key: 'status', header: 'Statut', width: 14 }, { key: 'freeVotes', header: 'Votes gratuits' }, { key: 'paidVotes', header: 'Votes payants' },
                    { key: 'totalVotes', header: 'Total' }, { key: 'juryScore', header: 'Note jury' }, { key: 'rank', header: 'Rang' }, { key: 'createdAt', header: 'Inscrit le', width: 20 },
                ],
                rows: () => cursorRows(AnimCandidate.find(filter).sort({ challengeId: 1, number: 1 }).lean().cursor(), (c: any) => ({ ...c, createdAt: fmtDate(c.createdAt) })),
            };
        case 'votes':
            return {
                title: 'Votes',
                columns: [
                    { key: 'at', header: 'Date', width: 20 }, { key: 'candidateId', header: 'Candidat', width: 26 }, { key: 'voterUserId', header: 'Votant', width: 26 },
                    { key: 'kind', header: 'Type' }, { key: 'quantity', header: 'Quantité' }, { key: 'status', header: 'Statut' }, { key: 'transactionId', header: 'Transaction', width: 26 },
                ],
                rows: () => cursorRows(AnimVote.find(filter).sort({ at: 1 }).lean().cursor(), (v: any) => ({ ...v, at: fmtDate(v.at), candidateId: String(v.candidateId), voterUserId: String(v.voterUserId), transactionId: v.transactionId ? String(v.transactionId) : '' })),
            };
        case 'transactions':
            return {
                title: 'Transactions',
                columns: [
                    { key: '_id', header: 'Transaction', width: 26 }, { key: 'createdAt', header: 'Date', width: 20 }, { key: 'userId', header: 'Acheteur', width: 26 },
                    { key: 'candidateId', header: 'Candidat', width: 26 }, { key: 'votes', header: 'Votes' }, { key: 'amount', header: 'Montant' }, { key: 'currency', header: 'Devise' },
                    { key: 'commissionAmount', header: 'Commission SBC' }, { key: 'organizerNet', header: 'Net organisateur' }, { key: 'status', header: 'Statut' },
                    { key: 'paymentSessionId', header: 'Référence paiement', width: 30 }, { key: 'lateSettlement', header: 'Hors délai' }, { key: 'review', header: 'Vérification' },
                ],
                rows: () => cursorRows(AnimVoteTransaction.find(filter).sort({ createdAt: 1 }).lean().cursor(), (t: any) => ({
                    ...t, _id: String(t._id), createdAt: fmtDate(t.createdAt), userId: String(t.userId), candidateId: String(t.candidateId),
                    lateSettlement: t.lateSettlement ? 'oui' : '', review: t.fraud?.review ?? '',
                })),
            };
        case 'leaderboard': {
            if (!scope.challengeId) throw new AppError('Choisissez un défi.', 400);
            const challenge = await AnimChallenge.findById(scope.challengeId);
            if (!challenge) throw new AppError('Défi introuvable.', 404);
            const entries = await computeEntries(challenge);
            return {
                title: `Classement — ${challenge.name}`,
                columns: [
                    { key: 'rank', header: 'Rang' }, { key: 'number', header: 'N°' }, { key: 'displayName', header: 'Nom', width: 28 },
                    { key: 'freeVotes', header: 'Votes gratuits' }, { key: 'paidVotes', header: 'Votes payants' }, { key: 'totalVotes', header: 'Total' },
                    { key: 'juryScore', header: 'Note jury' }, { key: 'score', header: 'Score' },
                ],
                rows: async function* () { for (const e of entries) yield e as unknown as Record<string, unknown>; },
            };
        }
        case 'results': {
            const results = await AnimResult.find(filter).lean();
            return {
                title: 'Résultats',
                columns: [
                    { key: 'challengeId', header: 'Défi', width: 26 }, { key: 'status', header: 'Statut' }, { key: 'rank', header: 'Rang' }, { key: 'number', header: 'N°' },
                    { key: 'displayName', header: 'Nom', width: 28 }, { key: 'totalVotes', header: 'Votes' }, { key: 'juryScore', header: 'Note jury' }, { key: 'score', header: 'Score' },
                    { key: 'sharedRank', header: 'Ex æquo' }, { key: 'frozenAt', header: 'Figé le', width: 20 }, { key: 'inputsHash', header: 'Empreinte', width: 30 },
                ],
                rows: async function* () {
                    for (const r of results) for (const e of r.entries) {
                        yield { ...e, challengeId: String(r.challengeId), status: r.status, sharedRank: e.sharedRank ? 'oui' : '', frozenAt: fmtDate(r.frozenAt), inputsHash: r.inputsHash };
                    }
                },
            };
        }
        case 'winners':
            return {
                title: 'Gagnants',
                columns: [
                    { key: 'awardedAt', header: 'Attribué le', width: 20 }, { key: 'rewardId', header: 'Récompense', width: 26 }, { key: 'userId', header: 'Gagnant', width: 26 },
                    { key: 'slotKey', header: 'Règle', width: 22 }, { key: 'ruleVersion', header: 'Version' }, { key: 'sharePct', header: 'Part %' },
                    { key: 'status', header: 'Statut' }, { key: 'deliveredAt', header: 'Remis le', width: 20 }, { key: 'deliveryNote', header: 'Note', width: 30 },
                ],
                rows: () => cursorRows(AnimRewardWinner.find(filter).sort({ awardedAt: 1 }).lean().cursor(), (w: any) => ({
                    ...w, awardedAt: fmtDate(w.awardedAt), deliveredAt: fmtDate(w.deliveredAt), rewardId: String(w.rewardId), userId: String(w.userId),
                })),
            };
        case 'audit':
            return {
                title: 'Journal',
                columns: [
                    { key: 'at', header: 'Date', width: 20 }, { key: 'actorRole', header: 'Rôle' }, { key: 'actorUserId', header: 'Auteur', width: 26 },
                    { key: 'action', header: 'Action', width: 24 }, { key: 'targetType', header: 'Objet' }, { key: 'targetId', header: 'Id', width: 26 },
                    { key: 'reason', header: 'Motif', width: 30 }, { key: 'after', header: 'Valeurs', width: 50 },
                ],
                rows: () => cursorRows(AnimAuditLog.find(filter).sort({ at: 1 }).lean().cursor(), (a: any) => ({
                    ...a, at: fmtDate(a.at), actorUserId: a.actorUserId ? String(a.actorUserId) : '', targetId: a.targetId ? String(a.targetId) : '',
                    after: a.after ? JSON.stringify(a.after).slice(0, 500) : '',
                })),
            };
        default:
            throw new AppError('Export inconnu.', 400);
    }
};

const csvCell = (v: unknown) => {
    const s = v === undefined || v === null ? '' : String(v);
    // Guard against formula injection when the file is opened in a spreadsheet.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",;\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const streamExport = async (res: Response, kind: ExportKind, format: ExportFormat, scope: { eventId?: string; challengeId?: string }) => {
    if (!['csv', 'xlsx', 'pdf'].includes(format)) throw new AppError('Format inconnu.', 400);
    const sheet = await buildSheet(kind, scope);
    const base = `sbc-${kind}-${new Date().toISOString().slice(0, 10)}`;

    if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
        res.write('﻿'); // Excel opens UTF-8 correctly only with a BOM
        res.write(`${sheet.columns.map((c) => csvCell(c.header)).join(';')}\n`);
        for await (const row of sheet.rows()) res.write(`${sheet.columns.map((c) => csvCell(row[c.key])).join(';')}\n`);
        res.end();
        return;
    }

    if (format === 'xlsx') {
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${base}.xlsx"`);
        const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true });
        const ws = wb.addWorksheet(sheet.title.slice(0, 31));
        ws.columns = sheet.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 14 }));
        ws.getRow(1).font = { bold: true };
        for await (const row of sheet.rows()) ws.addRow(row).commit();
        ws.commit();
        await wb.commit();
        return;
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.pdf"`);
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
    doc.pipe(res);
    doc.fontSize(16).text(`SBC Événement — ${sheet.title}`);
    doc.fontSize(9).fillColor('#666').text(`Généré le ${fmtDate(new Date())} UTC`).moveDown();
    const cols = sheet.columns.slice(0, 9);
    const width = (doc.page.width - 60) / cols.length;
    const line = (cells: string[], bold = false) => {
        const y = doc.y;
        doc.fillColor('#000').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
        cells.forEach((c, i) => doc.text(c.slice(0, 40), 30 + i * width, y, { width: width - 4, lineBreak: false }));
        doc.moveDown(0.8);
        if (doc.y > doc.page.height - 40) doc.addPage();
    };
    line(cols.map((c) => c.header), true);
    let n = 0;
    for await (const row of sheet.rows()) {
        if (n++ >= MAX_PDF_ROWS) {
            doc.moveDown().font('Helvetica-Oblique').text(`… liste tronquée à ${MAX_PDF_ROWS} lignes — utilisez l’export Excel ou CSV pour la totalité.`);
            break;
        }
        line(cols.map((c) => String(row[c.key] ?? '')));
    }
    doc.end();
};
