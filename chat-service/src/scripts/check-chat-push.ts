/**
 * New chat messages reach the other person's phone, with the sender's photo.
 *
 * Pure — the user-service and notification-service clients are faked.
 *   npx ts-node --transpile-only src/scripts/check-chat-push.ts
 */
import assert from 'assert';
import { userServiceClient } from '../services/clients/user.service.client';
import { avatarIcon, chatPushDeps, chatPushText, pushNewMessage, shouldPush } from '../services/chat-push.service';

const pushes: any[] = [];
chatPushDeps.send = async (p: any) => { pushes.push(p); };
(userServiceClient as any).getUserDetails = async () => ({
    _id: 's1', name: 'Paul Biya', avatar: 'https://storage.googleapis.com/sbc-file-storage/avatars/1700_paul.jpg',
});
const tick = () => new Promise(r => setTimeout(r, 20));

(async () => {
    // The sender's photo goes through our resizer, same origin, 128px.
    assert.strictEqual(avatarIcon('https://storage.googleapis.com/sbc-file-storage/avatars/1700_paul.jpg'), '/api/settings/files/avatars%2F1700_paul.jpg?w=128');
    assert.strictEqual(avatarIcon('/settings/files/abc'), '/api/settings/files/abc?w=128');
    assert.strictEqual(avatarIcon(undefined), undefined);

    // What the lock screen shows.
    assert.deepStrictEqual(chatPushText({ conversationType: 'direct', messageType: 'text', senderName: 'Paul', content: 'Salut !' }), { title: 'Paul', body: 'Salut !' });
    assert.deepStrictEqual(chatPushText({ conversationType: 'direct', messageType: 'document', senderName: 'Paul', content: 'x', documentName: 'facture.pdf' }), { title: 'Paul', body: '📄 facture.pdf' });
    assert.strictEqual(chatPushText({ conversationType: 'status_reply', messageType: 'text', senderName: 'Paul', content: 'Top' })!.title, 'Paul a répondu à ton statut');
    // SBC Love is encrypted at rest: nothing of it on a lock screen.
    assert.deepStrictEqual(chatPushText({ conversationType: 'love', messageType: 'text', senderName: 'Paul', content: 'secret' }), { title: 'SBC Love', body: 'Tu as un nouveau message.' });
    assert.strictEqual(chatPushText({ conversationType: 'direct', messageType: 'system', senderName: 'Paul', content: 'x' }), null);
    assert.ok(chatPushText({ conversationType: 'direct', messageType: 'text', senderName: 'P', content: 'a'.repeat(500) })!.body.length <= 140);

    // At most one buzz per conversation every 3 s.
    assert.strictEqual(shouldPush('r', 'c', 0), true);
    assert.strictEqual(shouldPush('r', 'c', 1000), false);
    assert.strictEqual(shouldPush('r', 'other', 1000), true);
    assert.strictEqual(shouldPush('r', 'c', 4000), true);

    // End to end: the recipient gets the sender's name, photo, and the conversation link.
    pushNewMessage({ conversationId: 'conv1', conversationType: 'direct', senderId: 's1', recipients: ['u2'], messageType: 'text', content: 'On se voit demain ?' });
    await tick();
    assert.deepStrictEqual(pushes.pop(), {
        userId: 'u2', title: 'Paul Biya', body: 'On se voit demain ?', url: '/chat?conversation=conv1', tag: 'chat-conv1',
        icon: '/api/settings/files/avatars%2F1700_paul.jpg?w=128',
    });

    // Love: no photo either.
    pushNewMessage({ conversationId: 'conv2', conversationType: 'love', senderId: 's1', recipients: ['u2'], messageType: 'text', content: 'x' });
    await tick();
    assert.strictEqual(pushes.pop().icon, undefined);

    console.log('✅ chat pushes OK');
})().catch(err => { console.error(err); process.exit(1); });
