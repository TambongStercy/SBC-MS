/**
 * Members delete only their own story; an admin can remove anyone's.
 *   npx -y -p node@20 node -r ts-node/register src/scripts/check-story-delete.ts
 */
import mongoose, { Types } from 'mongoose';
import StatusModel from '../database/models/status.model';
import { statusService } from '../services/status.service';

const DB = process.env.STORY_DELETE_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_chat_story_delete_check';
let failures = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; };

(async () => {
    await mongoose.connect(DB, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.dropDatabase();
    const author = new Types.ObjectId(), other = new Types.ObjectId(), admin = new Types.ObjectId();
    const make = async () => (await StatusModel.collection.insertOne({
        authorId: author, category: 'general', content: 'x', mediaType: 'text', deleted: false,
        likesCount: 0, repostsCount: 0, repliesCount: 0, viewsCount: 0, expiresAt: new Date(Date.now() + 864e5), createdAt: new Date(),
    })).insertedId.toString();

    const a = await make();
    check('another member cannot delete it', (await statusService.deleteStatus(a, other.toString())) === null);
    check('the author can delete it', (await statusService.deleteStatus(a, author.toString())) !== null);
    const b = await make();
    check('an admin can delete someone else’s', (await statusService.deleteStatus(b, admin.toString(), true)) !== null);
    check('it is really marked deleted', (await StatusModel.collection.findOne({ _id: new Types.ObjectId(b) }))?.deleted === true);
    check('deleting twice reports not found', (await statusService.deleteStatus(b, admin.toString(), true)) === null);

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `${failures} FAILED` : 'all passed');
    process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
