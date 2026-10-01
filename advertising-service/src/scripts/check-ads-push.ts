/**
 * Every Ads Network notification also reaches the phone: the email's subject
 * as title, its first paragraph as text, and the page its button opens.
 * Also the new ones: campaign live, video proof approved / refused.
 *
 * Pure — the HTTP client is faked, no server, no Mongo.
 *   npx ts-node --transpile-only src/scripts/check-ads-push.ts
 */
import assert from 'assert';
import axios from 'axios';

const posts: Array<{ url: string; body: any }> = [];
(axios as any).create = () => ({
    post: async (url: string, body: any) => { posts.push({ url, body }); return { data: { success: true } }; },
    get: async () => { throw new Error('no user-service here'); },
});

(async () => {
    const n = await import('../services/clients/notification.service.client');
    const pushes = () => posts.filter(p => p.url === '/notifications/push/internal/send').map(p => p.body);

    await n.notifyDayOpened('u1', 'Promo Tecno', 2);
    let p = pushes().pop();
    assert.strictEqual(p.category, 'ads');
    assert.strictEqual(p.title, '🚀 Jour 2 disponible');
    assert.strictEqual(p.body, 'Vous pouvez maintenant publier le jour 2 de « Promo Tecno ».');
    assert.strictEqual(p.url, '/ads-network/diffuseur');

    await n.notifyCampaignRejected('u2', 'Ma pub', 'image floue');
    p = pushes().pop();
    assert.strictEqual(p.url, '/ads-network/annonceur');
    assert.strictEqual(p.body, 'Votre campagne « Ma pub » n\'a pas été validée.');

    // No button in the email → the diffuseur space.
    await n.notifyCampaignForfeited('u3', 'X');
    assert.strictEqual(pushes().pop().url, '/ads-network/diffuseur');

    // Pushed even though no email address could be found for the user.
    assert.ok(!posts.some(x => x.url === '/notifications/internal/create'), 'no email without an address');

    await n.notifyCampaignLive('u2', 'Ma pub');
    assert.strictEqual(pushes().pop().title, '🚀 Votre campagne est en ligne');

    await n.notifyManualVerificationApproved('u1', 3, 420, 840);
    assert.strictEqual(pushes().pop().body, 'Votre preuve du jour 3 a été validée : 420 vues, 840 FCFA.');

    await n.notifyManualVerificationRejected('u1', 3, 'vidéo coupée');
    assert.strictEqual(pushes().pop().body, 'Votre preuve du jour 3 n\'a pas été validée. Motif : vidéo coupée');

    // A long first paragraph is cut, not dropped.
    await n.notifyReferralSuspended('u4');
    assert.ok(pushes().pop().body.length <= 180);

    console.log('✅ Ads Network pushes OK');
})().catch(err => { console.error(err); process.exit(1); });
