import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import {
    DormancyActionError, dormancySummary, exportStatus, listDormant, markChecked, openExportFile, parseDormantFilters, requestFreeze, startExport,
} from '../../services/dormancy.service';
import {
    approveReactivationText, cancelCampaign, createCampaign, getReactivationText, listCampaigns, previewCampaign, saveReactivationDraft,
} from '../../services/dormancy-campaign.service';
import logger from '../../utils/logger';

const log = logger.getLogger('DormancyController');

/**
 * Security plan Phase 7: admin « Comptes dormants » (gateway module: finance).
 * Reads (and the CSV export, a read-only POST) need finance read; marking
 * checked and asking a freeze need finance write.
 */
const adminId = (req: AuthenticatedRequest) => String(req.user?.userId ?? req.user?.id ?? '');

function fail(res: Response, err: any, what: string) {
    if (err instanceof DormancyActionError) {
        res.status(err.status).json({ success: false, message: err.message });
        return;
    }
    log.error(`${what} failed: ${err?.message ?? err}`);
    res.status(500).json({ success: false, message: 'Comptes dormants indisponibles' });
}

export async function getDormantSummary(_req: AuthenticatedRequest, res: Response): Promise<void> {
    try { res.json({ success: true, data: await dormancySummary() }); }
    catch (err) { fail(res, err, 'Dormant summary'); }
}

export async function getDormantList(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
        const q = req.query as Record<string, unknown>;
        const data = await listDormant(parseDormantFilters(q), {
            cursor: typeof q.cursor === 'string' ? q.cursor : null,
            limit: Number(q.limit) || 50,
        });
        res.json({ success: true, data });
    } catch (err) { fail(res, err, 'Dormant list'); }
}

export async function postDormantExport(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
        const data = await startExport(parseDormantFilters({ ...(req.body?.filters ?? {}) }), adminId(req));
        res.status(202).json({ success: true, data });
    } catch (err) { fail(res, err, 'Dormant export'); }
}

export async function getDormantExport(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
        const data = await exportStatus(req.params.exportId);
        if (!data) { res.status(404).json({ success: false, message: 'Export introuvable (les exports sont gardés 24 h)' }); return; }
        res.json({ success: true, data });
    } catch (err) { fail(res, err, 'Dormant export status'); }
}

export async function downloadDormantExport(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
        const file = await openExportFile(req.params.exportId);
        if (!file) { res.status(404).json({ success: false, message: 'Export introuvable ou pas encore prêt' }); return; }
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
        res.setHeader('Cache-Control', 'no-store');
        log.info(`Dormant export ${req.params.exportId} downloaded by admin ${adminId(req)}`);
        file.stream.on('error', (e: any) => { log.error(`Export stream failed: ${e?.message}`); res.end(); });
        file.stream.pipe(res);
    } catch (err) { fail(res, err, 'Dormant export download'); }
}

export async function postDormantChecked(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
        const note = typeof req.body?.note === 'string' && req.body.note.trim() ? req.body.note.trim() : null;
        await markChecked(req.params.userId, adminId(req), note);
        res.json({ success: true });
    } catch (err) { fail(res, err, 'Mark dormant checked'); }
}

export async function postDormantFreezeRequest(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
        const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
        const data = await requestFreeze(req.params.userId, adminId(req), reason);
        res.status(201).json({ success: true, data });
    } catch (err) { fail(res, err, 'Dormant freeze request'); }
}

// ---------------------------------------------------------------- Phase 7 part 2: réactivation campaign
// Text read: finance read. Draft save and approval: super admin only (route + gateway).
// Preview: finance read (a read-only POST). Send and cancel: finance write; send needs the admin's code.

export async function getReactivationTextHandler(_req: AuthenticatedRequest, res: Response): Promise<void> {
    try { res.json({ success: true, data: await getReactivationText() }); }
    catch (err) { fail(res, err, 'Reactivation text'); }
}

export async function putReactivationDraft(req: AuthenticatedRequest, res: Response): Promise<void> {
    try { res.json({ success: true, data: await saveReactivationDraft(req.body ?? {}, adminId(req)) }); }
    catch (err) { fail(res, err, 'Reactivation draft'); }
}

export async function postApproveReactivationText(req: AuthenticatedRequest, res: Response): Promise<void> {
    try { res.json({ success: true, data: await approveReactivationText(adminId(req)) }); }
    catch (err) { fail(res, err, 'Reactivation approval'); }
}

export async function postReactivationPreview(req: AuthenticatedRequest, res: Response): Promise<void> {
    try { res.json({ success: true, data: await previewCampaign(parseDormantFilters({ ...(req.body?.filters ?? {}) })) }); }
    catch (err) { fail(res, err, 'Reactivation preview'); }
}

export async function postReactivationCampaign(req: AuthenticatedRequest, res: Response): Promise<void> {
    try { res.status(202).json({ success: true, data: await createCampaign(parseDormantFilters({ ...(req.body?.filters ?? {}) }), adminId(req)) }); }
    catch (err) { fail(res, err, 'Reactivation campaign'); }
}

export async function getReactivationCampaigns(_req: AuthenticatedRequest, res: Response): Promise<void> {
    try { res.json({ success: true, data: await listCampaigns() }); }
    catch (err) { fail(res, err, 'Reactivation campaigns'); }
}

export async function postCancelReactivationCampaign(req: AuthenticatedRequest, res: Response): Promise<void> {
    try { res.json({ success: true, data: await cancelCampaign(req.params.campaignId, adminId(req)) }); }
    catch (err) { fail(res, err, 'Reactivation cancel'); }
}
