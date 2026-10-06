import { Request, Response } from 'express';
import RelanceBounceSuppressionModel from '../../database/models/relance-bounce-suppression.model';
import { isValidUnsubscribe } from '../../utils/relance-unsubscribe';
import logger from '../../utils/logger';

const log = logger.getLogger('RelanceUnsubscribe');

const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const page = (title: string, body: string) => `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f6f9;color:#1f2937">
<div style="max-width:440px;margin:15vh auto 0;padding:32px 28px;background:#fff;border-radius:16px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.06)">
<p style="margin:0 0 6px;font-weight:700;color:#115CF6">Sniper Business Center</p>
${body}
</div></body></html>`;

/**
 * GET only asks. Mail scanners and link previews open every link in a
 * message, so a GET that unsubscribed would quietly remove people who never
 * clicked; the button POSTs, like Gmail's own one-click unsubscribe does.
 */
export function relanceUnsubscribePage(req: Request, res: Response): void {
    const { e, t } = req.query;
    if (!isValidUnsubscribe(e, t)) {
        res.status(400).type('html').send(page('Lien invalide', '<h1 style="font-size:20px">Ce lien n\'est pas valide</h1><p>Utilisez le lien « Se désabonner » de l\'email reçu.</p>'));
        return;
    }
    const action = `?e=${encodeURIComponent(e)}&t=${encodeURIComponent(String(t))}`;
    res.status(200).type('html').send(page('Se désabonner', `
<h1 style="font-size:20px;margin:8px 0 12px">Ne plus recevoir ces emails ?</h1>
<p style="color:#4b5563;line-height:1.5">Les emails de suivi SBC ne seront plus envoyés à <strong>${escape(e)}</strong>.</p>
<form method="post" action="${action}"><button type="submit" style="margin-top:12px;padding:12px 22px;border:0;border-radius:999px;background:#115CF6;color:#fff;font-size:15px;font-weight:600;cursor:pointer">Me désabonner</button></form>`));
}

export async function relanceUnsubscribeConfirm(req: Request, res: Response): Promise<void> {
    const { e, t } = req.query;
    if (!isValidUnsubscribe(e, t)) {
        res.status(400).type('html').send(page('Lien invalide', '<h1 style="font-size:20px">Ce lien n\'est pas valide</h1>'));
        return;
    }
    const email = e.trim().toLowerCase();
    await RelanceBounceSuppressionModel.updateOne(
        { email },
        { $setOnInsert: { email, reason: 'Unsubscribed from relance emails', bouncedAt: new Date(), source: 'unsubscribe' } },
        { upsert: true },
    );
    log.info(`Unsubscribed ${email} from relance emails`);
    res.status(200).type('html').send(page('Désabonné', `
<h1 style="font-size:20px;margin:8px 0 12px">C'est noté</h1>
<p style="color:#4b5563;line-height:1.5">Vous ne recevrez plus les emails de suivi SBC à <strong>${escape(email)}</strong>.</p>`));
}
