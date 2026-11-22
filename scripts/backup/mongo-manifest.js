// Counts of every collection of the backed-up databases, for the restore test. estimatedDocumentCount:
// metadata only, no scan, safe on prod at night. SBC_MANIFEST_SCOPE=prod (default: every database
// but *_preprod) or preprod (only *_preprod); admin/local/config never.
const scope = process.env.SBC_MANIFEST_SCOPE || 'prod';
const skip = (n) => ['admin', 'local', 'config'].includes(n) || (scope === 'preprod' ? !/_preprod$/.test(n) : /_preprod$/.test(n));
const out = {};
for (const d of db.adminCommand({ listDatabases: 1, nameOnly: true }).databases.map((x) => x.name).filter((n) => !skip(n))) {
    const s = db.getSiblingDB(d);
    out[d] = {};
    for (const c of s.getCollectionInfos({ type: 'collection' }, { nameOnly: true }).map((x) => x.name)) {
        if (c.startsWith('system.')) continue;
        try { out[d][c] = s.getCollection(c).estimatedDocumentCount(); } catch (e) { out[d][c] = null; }
    }
}
print(JSON.stringify(out));
